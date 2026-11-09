ARG HERMES_IMAGE=nousresearch/hermes-agent@sha256:adb7890916de63245523492be8f68f9d2095fecbec4e2a6dab7960381f0fc002
FROM ${HERMES_IMAGE}
USER root
COPY . /opt/hermes-projects
RUN /opt/hermes/.venv/bin/python -c "import subprocess; from pm import uv_launcher; subprocess.run([str(uv_launcher('uv')), 'pip', 'install', '--python', '/opt/hermes/.venv/bin/python', '--no-deps', '/opt/hermes-projects'], check=True)"
USER hermes
ENV HERMES_HOME=/tmp/hermes-projects-home HERMES_DASHBOARD=0
ENTRYPOINT ["/opt/hermes/.venv/bin/python", "/opt/hermes-projects/tests/docker/start.py"]
