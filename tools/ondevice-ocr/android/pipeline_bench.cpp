// Both models resident at once, the way the app would hold them.
// usage: pipeline_bench <m1> <in1> <m2> <in2> <iters> <threads>
#include <onnxruntime_cxx_api.h>
#include <algorithm>
#include <chrono>
#include <cstdio>
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
static long peak_rss_kb() {
  std::ifstream f("/proc/self/status"); std::string k; long v = 0;
  while (f >> k) { if (k == "VmHWM:") { f >> v; break; } }
  return v;
}

int main(int argc, char** argv) {
  if (argc < 7) { fprintf(stderr, "usage: pipeline_bench m1 in1 m2 in2 iters threads\n"); return 1; }
  const int iters = atoi(argv[5]), threads = atoi(argv[6]);
  Ort::Env env(ORT_LOGGING_LEVEL_ERROR, "pipe");
  Ort::SessionOptions so;
  so.SetIntraOpNumThreads(threads);
  so.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);

  printf("rss after start          : %6ld KB\n", peak_rss_kb());
  auto t0 = std::chrono::steady_clock::now();
  Ort::Session s1(env, argv[1], so), s2(env, argv[3], so);
  double load_ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  printf("rss with both models     : %6ld KB   (load %.0f ms)\n", peak_rss_kb(), load_ms);

  Ort::AllocatorWithDefaultOptions al;
  auto n1i = s1.GetInputNameAllocated(0, al), n1o = s1.GetOutputNameAllocated(0, al);
  auto n2i = s2.GetInputNameAllocated(0, al), n2o = s2.GetOutputNameAllocated(0, al);
  auto sh1 = s1.GetInputTypeInfo(0).GetTensorTypeAndShapeInfo().GetShape();
  auto sh2 = s2.GetInputTypeInfo(0).GetTensorTypeAndShapeInfo().GetShape();
  auto d1 = read_bin(argv[2]), d2 = read_bin(argv[4]);
  auto mem = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  auto t1 = Ort::Value::CreateTensor<float>(mem, d1.data(), d1.size(), sh1.data(), sh1.size());
  auto t2 = Ort::Value::CreateTensor<float>(mem, d2.data(), d2.size(), sh2.data(), sh2.size());
  const char *i1[] = {n1i.get()}, *o1[] = {n1o.get()}, *i2[] = {n2i.get()}, *o2[] = {n2o.get()};

  std::vector<double> ms;
  for (int i = 0; i < iters + 2; ++i) {
    auto a = std::chrono::steady_clock::now();
    auto r1 = s1.Run(Ort::RunOptions{nullptr}, i1, &t1, 1, o1, 1);
    auto r2 = s2.Run(Ort::RunOptions{nullptr}, i2, &t2, 1, o2, 1);
    double dt = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - a).count();
    if (i >= 2) ms.push_back(dt);
  }
  std::sort(ms.begin(), ms.end());
  printf("rss peak while inferring : %6ld KB\n", peak_rss_kb());
  printf("BOTH STAGES threads=%d  min=%.1f  median=%.1f  mean=%.1f  max=%.1f ms\n",
         threads, ms.front(), ms[ms.size()/2],
         std::accumulate(ms.begin(), ms.end(), 0.0)/ms.size(), ms.back());
  return 0;
}
