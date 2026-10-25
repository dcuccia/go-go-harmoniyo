# syntax=docker/dockerfile:1
# Anticipatory Music Transformer accompaniment workload for the cuccia AI node (contract v0).
#   /inputs/melody.mid + /inputs/args.json  ->  /outputs/accompaniment.mid, combined.mid, report.json
# Weights are baked in (the image digest pins them); the container needs no network.
#
# Build (GPU image for the node; CUDA 12.4 wheels run on the node's CUDA 13.x driver):
#   docker build -t go-go-harmoniyo-amt:cu124 spikes/s6-ai-arranging/amt
# Build a CPU image for a local smoke test (no GPU needed, much slower):
#   docker build --build-arg TORCH_INDEX=https://download.pytorch.org/whl/cpu -t go-go-harmoniyo-amt:cpu spikes/s6-ai-arranging/amt
# Small model instead of medium (about 3x faster, lower quality):
#   --build-arg MODEL_REPO=stanford-crfm/music-small-800k --build-arg MODEL_REVISION=fa800530aa1126dd6b58b38f3bdb8fcec9c9d4f5 \
#   --build-arg MODEL_SHA256=45af5006d529a19af3654c729192c072f3aeb9e7e13e9eaf92c19bfd7c87e4d8 --build-arg MODEL_NAME=music-small-800k

ARG PYTHON_IMAGE=python:3.11-slim-bookworm@sha256:f06d01d4ba3f8ad5af45a3ec87df19c1d317d8e8961edc0fabda61811af6f7cf

# ---- weights: downloaded once at build time, verified against the pinned SHA-256 -------------
FROM ${PYTHON_IMAGE} AS weights
ARG MODEL_REPO=stanford-crfm/music-medium-800k
ARG MODEL_REVISION=93b6eb7e09bad33be6cb2ebd50ce5279cbfde7f6
ARG MODEL_SHA256=7af65dbabb2f6b7df9df03c2ea5b1909b74043591ba578fb663d80fcf82241ad
RUN pip install --no-cache-dir huggingface_hub==0.36.2 \
 && python -c "from huggingface_hub import snapshot_download as s; s('${MODEL_REPO}', revision='${MODEL_REVISION}', local_dir='/model', allow_patterns=['config.json', 'pytorch_model.bin', 'README.md'])" \
 && echo "${MODEL_SHA256}  /model/pytorch_model.bin" | sha256sum -c - \
 && rm -rf /model/.cache

# ---- runtime ----------------------------------------------------------------------------------
FROM ${PYTHON_IMAGE}
ARG TORCH_INDEX=https://download.pytorch.org/whl/cu124
ARG ANTICIPATION_SHA=af37397922665a0fb8d474d7988b0f3755a38d45
ARG MODEL_NAME=music-medium-800k
LABEL org.opencontainers.image.title="go-go-harmoniyo-amt" \
      org.opencontainers.image.description="Anticipatory Music Transformer accompaniment (Go Go HarmoniYo spike S6)" \
      org.opencontainers.image.source="https://github.com/dcuccia/go-go-harmoniyo" \
      org.opencontainers.image.licenses="MIT AND Apache-2.0"
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir torch==2.6.0 --index-url ${TORCH_INDEX} \
 && pip install --no-cache-dir -r /tmp/requirements.txt \
 && pip install --no-cache-dir --no-deps "https://github.com/jthickstun/anticipation/archive/${ANTICIPATION_SHA}.tar.gz" \
 && rm -rf /root/.cache /tmp/requirements.txt
COPY --from=weights /model /opt/models/${MODEL_NAME}
COPY amt_accompany.py /app/amt_accompany.py
ENV AMT_MODEL_DIR=/opt/models/${MODEL_NAME} \
    AMT_INPUTS=/inputs \
    AMT_OUTPUTS=/outputs \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HOME=/tmp \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TQDM_DISABLE=1
USER 10001:10001
WORKDIR /outputs
ENTRYPOINT ["python", "/app/amt_accompany.py"]
