# Browser inference release checklist

- [ ] exact model artifact byte lengths verified
- [ ] SHA-256 digest recorded for every model artifact
- [ ] `integrity_status` changed only after verification
- [ ] matching Transformers.js and ONNX Runtime Web assets deployed
- [ ] immutable cache headers configured for revisioned model assets
- [ ] HTTPS deployment and WebGPU availability verified
- [ ] network assertion proves source images never leave the browser
- [ ] preprocessing fixtures accepted
- [ ] supported-device accuracy and latency thresholds accepted
- [ ] cold download, cached load, compile, and warm-up gates accepted
- [ ] cancellation and latest-request supersession soak passed
- [ ] WebGPU device-loss recovery exercised
- [ ] low-storage, cache-eviction, offline, and model-host failure flows exercised
- [ ] license and NOTICE review approved
- [ ] static-host rollback procedure exercised
