# Authenticated static edge: ALB (OIDC) -> nginx -> S3 artifact bucket.
#
# GovCloud: mirror this base image into a private ECR repository and pin it by digest. Tasks run
# in isolated subnets and can only pull from ECR.
ARG NGINX_IMAGE=public.ecr.aws/nginx/nginx-unprivileged:stable-alpine
FROM ${NGINX_IMAGE}

COPY nginx.conf /etc/nginx/nginx.conf
COPY snippets/ /etc/nginx/snippets/
COPY templates/ /etc/nginx/templates/

# The base image's entrypoint renders /etc/nginx/templates/**/*.template with envsubst at
# startup. Rendering into /tmp (a writable volume) lets the root filesystem stay read-only, and
# the filter stops envsubst from touching nginx's own $variables.
ENV NGINX_ENVSUBST_OUTPUT_DIR=/tmp \
    NGINX_ENVSUBST_FILTER="^(ASSETS_BUCKET_HOST|DNS_RESOLVER)$" \
    DNS_RESOLVER=169.254.169.253

EXPOSE 8080
