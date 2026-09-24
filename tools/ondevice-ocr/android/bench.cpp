// Minimal ONNX Runtime latency probe for Android arm64.
// usage: bench <model.onnx> <input.bin> <iters> <intra_threads> [nnapi] [out.bin]
#include <onnxruntime_cxx_api.h>
#include <nnapi_provider_factory.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <numeric>
#include <string>
#include <vector>

static std::vector<float> read_bin(const std::string& p) {
  std::ifstream f(p, std::ios::binary | std::ios::ate);
  if (!f) { fprintf(stderr, "cannot open %s\n", p.c_str()); exit(2); }
  size_t n = (size_t)f.tellg() / sizeof(float);
  f.seekg(0);
  std::vector<float> v(n);
  f.read(reinterpret_cast<char*>(v.data()), n * sizeof(float));
  return v;
}

int main(int argc, char** argv) {
  if (argc < 5) { fprintf(stderr, "usage: bench model.onnx input.bin iters threads [nnapi] [out.bin]\n"); return 1; }
  const std::string model = argv[1], input_path = argv[2];
  const int iters = atoi(argv[3]), threads = atoi(argv[4]);
  const bool use_nnapi = (argc > 5 && std::string(argv[5]) == "nnapi");
  const char* out_path = (argc > 6) ? argv[6] : nullptr;

  Ort::Env env(ORT_LOGGING_LEVEL_ERROR, "bench");
  Ort::SessionOptions so;
  so.SetIntraOpNumThreads(threads);
  so.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
  if (use_nnapi) {
    if (OrtSessionOptionsAppendExecutionProvider_Nnapi(so, 0) != nullptr) {
      fprintf(stderr, "NNAPI EP unavailable\n"); return 3;
    }
  }

  auto t_load0 = std::chrono::steady_clock::now();
  Ort::Session session(env, model.c_str(), so);
  double load_ms = std::chrono::duration<double, std::milli>(
      std::chrono::steady_clock::now() - t_load0).count();

  Ort::AllocatorWithDefaultOptions alloc;
  auto in_name = session.GetInputNameAllocated(0, alloc);
  auto out_name = session.GetOutputNameAllocated(0, alloc);
  auto in_shape = session.GetInputTypeInfo(0).GetTensorTypeAndShapeInfo().GetShape();

  size_t need = 1;
  for (auto d : in_shape) need *= (size_t)d;
  std::vector<float> data = read_bin(input_path);
  if (data.size() != need) {
    fprintf(stderr, "input has %zu floats, model wants %zu\n", data.size(), need);
    return 4;
  }

  auto mem = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  Ort::Value in_tensor = Ort::Value::CreateTensor<float>(
      mem, data.data(), data.size(), in_shape.data(), in_shape.size());
  const char* in_names[] = {in_name.get()};
  const char* out_names[] = {out_name.get()};

  std::vector<double> ms;
  ms.reserve(iters);
  for (int i = 0; i < iters + 2; ++i) {           // 2 untimed warm-ups
    auto t0 = std::chrono::steady_clock::now();
    auto outs = session.Run(Ort::RunOptions{nullptr}, in_names, &in_tensor, 1, out_names, 1);
    double dt = std::chrono::duration<double, std::milli>(
        std::chrono::steady_clock::now() - t0).count();
    if (i >= 2) ms.push_back(dt);
    if (out_path && i == iters + 1) {             // dump the last output for parity checking
      auto info = outs[0].GetTensorTypeAndShapeInfo();
      size_t n = info.GetElementCount();
      std::ofstream f(out_path, std::ios::binary);
      f.write(reinterpret_cast<const char*>(outs[0].GetTensorData<float>()), n * sizeof(float));
    }
  }

  std::sort(ms.begin(), ms.end());
  double med = ms[ms.size() / 2];
  double mean = std::accumulate(ms.begin(), ms.end(), 0.0) / ms.size();
  printf("%-34s threads=%d ep=%-5s load=%7.1fms  min=%7.1f  median=%7.1f  mean=%7.1f  max=%7.1f\n",
         model.substr(model.find_last_of('/') + 1).c_str(), threads,
         use_nnapi ? "nnapi" : "cpu", load_ms, ms.front(), med, mean, ms.back());
  return 0;
}
