# syntax=docker/dockerfile:1
#
# Build context: services/frontend-api
#
# Base images are build args because GovCloud accounts usually cannot pull
# from public registries at deploy time: mirror them into a private ECR
# repository (and pin by digest) and pass the mirrored URIs here.
ARG BUILDER_IMAGE=public.ecr.aws/docker/library/rust:1-bookworm
ARG RUNTIME_IMAGE=gcr.io/distroless/cc-debian12:nonroot

FROM ${BUILDER_IMAGE} AS builder
WORKDIR /build

# Compile dependencies on their own layer so source-only changes rebuild fast.
# (rust-toolchain.toml is not copied: the builder image pins the toolchain.)
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
    && cargo build --release --locked \
    && rm -rf src

# `touch` so cargo never mistakes the placeholder binary above for up to date.
COPY src ./src
RUN touch src/main.rs && cargo build --release --locked

# distroless/cc: glibc + CA certificates, no shell or package manager.
FROM ${RUNTIME_IMAGE}
COPY --from=builder /build/target/release/frontend-api /usr/local/bin/frontend-api
USER nonroot
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/frontend-api"]
