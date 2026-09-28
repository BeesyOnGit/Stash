//! The spectrogram MDX-Net models read and write: torch.stft / torch.istft with
//! a periodic Hann window, center=True (reflect padding), no normalisation,
//! cut to the model's `dim_f` lowest bins. Laid out as the model's
//! [4, dim_f, dim_t] tensor: left real, left imaginary, right real, right imaginary.
//!
//! Both channels go through one complex FFT (left + i·right) and are pulled
//! apart by symmetry, which halves the work. (Port of the phone app's MdxStft.kt.)

use std::f64::consts::PI;
use std::sync::Arc;

use rustfft::num_complex::Complex32;
use rustfft::{Fft, FftPlanner};

pub struct MdxStft {
    n_fft: usize,
    hop: usize,
    dim_f: usize,
    dim_t: usize,
    /// Samples per channel in one model input.
    pub chunk: usize,
    pub size: usize,
    pad: usize,
    bins: usize,
    window: Vec<f32>,
    forward: Arc<dyn Fft<f32>>,
    inverse: Arc<dyn Fft<f32>>,
    buf: Vec<Complex32>,
    scratch: Vec<Complex32>,
    padded_l: Vec<f32>,
    padded_r: Vec<f32>,
    ola_l: Vec<f32>,
    ola_r: Vec<f32>,
    /// Σ window² under each output sample, what istft divides by.
    envelope: Vec<f32>,
}

impl MdxStft {
    pub fn new(n_fft: usize, hop: usize, dim_f: usize, dim_t: usize) -> Self {
        let chunk = hop * (dim_t - 1);
        let pad = n_fft / 2;
        assert!(chunk > pad, "chunk too short for the FFT size");
        let window: Vec<f32> = (0..n_fft)
            .map(|i| (0.5 - 0.5 * (2.0 * PI * i as f64 / n_fft as f64).cos()) as f32)
            .collect();
        let mut envelope = vec![0f32; chunk + n_fft];
        for t in 0..dim_t {
            for i in 0..n_fft {
                envelope[t * hop + i] += window[i] * window[i];
            }
        }
        let mut planner = FftPlanner::<f32>::new();
        let forward = planner.plan_fft_forward(n_fft);
        let inverse = planner.plan_fft_inverse(n_fft);
        let scratch_len = forward
            .get_inplace_scratch_len()
            .max(inverse.get_inplace_scratch_len());
        Self {
            n_fft,
            hop,
            dim_f,
            dim_t,
            chunk,
            size: 4 * dim_f * dim_t,
            pad,
            bins: dim_f.min(n_fft / 2 + 1),
            window,
            forward,
            inverse,
            buf: vec![Complex32::new(0.0, 0.0); n_fft],
            scratch: vec![Complex32::new(0.0, 0.0); scratch_len],
            padded_l: vec![0.0; chunk + n_fft],
            padded_r: vec![0.0; chunk + n_fft],
            ola_l: vec![0.0; chunk + n_fft],
            ola_r: vec![0.0; chunk + n_fft],
            envelope,
        }
    }

    /// `chunk` samples per channel → `spec` ([size]); the 3 lowest bins zeroed, as UVR does.
    pub fn forward(&mut self, left: &[f32], right: &[f32], spec: &mut [f32]) {
        reflect_pad(left, &mut self.padded_l, self.pad, self.chunk);
        reflect_pad(right, &mut self.padded_r, self.pad, self.chunk);
        let n = self.n_fft;
        let plane = self.dim_f * self.dim_t;
        for t in 0..self.dim_t {
            let off = t * self.hop;
            for i in 0..n {
                let w = self.window[i];
                self.buf[i] = Complex32::new(self.padded_l[off + i] * w, self.padded_r[off + i] * w);
            }
            self.forward.process_with_scratch(&mut self.buf, &mut self.scratch);
            for k in 0..self.dim_f {
                let at = k * self.dim_t + t;
                if k < 3 || k >= self.bins {
                    spec[at] = 0.0;
                    spec[plane + at] = 0.0;
                    spec[2 * plane + at] = 0.0;
                    spec[3 * plane + at] = 0.0;
                    continue;
                }
                let kk = if k == 0 { 0 } else { n - k };
                let (a, b) = (self.buf[k].re, self.buf[k].im);
                let (c, d) = (self.buf[kk].re, self.buf[kk].im);
                spec[at] = (a + c) * 0.5; // left real
                spec[plane + at] = (b - d) * 0.5; // left imaginary
                spec[2 * plane + at] = (b + d) * 0.5; // right real
                spec[3 * plane + at] = (c - a) * 0.5; // right imaginary
            }
        }
    }

    /// `spec` ([size]) → `chunk` samples per channel.
    pub fn inverse(&mut self, spec: &[f32], left: &mut [f32], right: &mut [f32]) {
        self.ola_l.fill(0.0);
        self.ola_r.fill(0.0);
        let n = self.n_fft;
        let plane = self.dim_f * self.dim_t;
        let nyquist = n / 2;
        let scale = 1.0 / n as f32;
        for t in 0..self.dim_t {
            self.buf.fill(Complex32::new(0.0, 0.0));
            for k in 0..self.bins {
                let at = k * self.dim_t + t;
                let lr = spec[at];
                let rr = spec[2 * plane + at];
                // A real signal's DC and Nyquist bins are real; irfft ignores their imaginary parts.
                let edge = k == 0 || k == nyquist;
                let li = if edge { 0.0 } else { spec[plane + at] };
                let ri = if edge { 0.0 } else { spec[3 * plane + at] };
                // Z[k] = L + iR; Z[N-k] = conj(L) + i·conj(R).
                self.buf[k] = Complex32::new(lr - ri, li + rr);
                if !edge {
                    self.buf[n - k] = Complex32::new(lr + ri, rr - li);
                }
            }
            self.inverse.process_with_scratch(&mut self.buf, &mut self.scratch);
            let off = t * self.hop;
            for i in 0..n {
                let w = self.window[i] * scale;
                self.ola_l[off + i] += self.buf[i].re * w;
                self.ola_r[off + i] += self.buf[i].im * w;
            }
        }
        for i in 0..self.chunk {
            let e = self.envelope[self.pad + i];
            left[i] = self.ola_l[self.pad + i] / e;
            right[i] = self.ola_r[self.pad + i] / e;
        }
    }
}

/// torch's reflect padding: `pad` mirrored samples each side, the edge sample not repeated.
fn reflect_pad(x: &[f32], out: &mut [f32], pad: usize, chunk: usize) {
    out[pad..pad + chunk].copy_from_slice(&x[..chunk]);
    for j in 0..pad {
        out[j] = x[pad - j];
        out[pad + chunk + j] = x[chunk - 2 - j];
    }
}
