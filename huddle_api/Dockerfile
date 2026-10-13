# Multi-stage build: dependencies cached in their own layer (cargo-chef), the runtime image only holds the binary.
FROM rust:1-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
RUN cargo build --release --locked --bin huddle_api

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home huddle
COPY --from=builder /app/target/release/huddle_api /usr/local/bin/huddle_api
USER huddle
ENV RUST_LOG=huddle_api=info,tower_http=info
EXPOSE 8080
CMD ["huddle_api"]
