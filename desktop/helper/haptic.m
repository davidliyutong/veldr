// One tick of the trackpad's haptic feedback (NSHapticFeedbackManager), as a
// Node-API module the shell loads in its main process (src/haptics.ts):
// its exports are one function without arguments. AppKit's performer is
// called on the main thread, where the main process runs JavaScript; it
// plays only while a finger is on a Force Touch trackpad, and does nothing
// otherwise. The few Node-API functions used are declared here, from
// Node-API's stable ABI, so that no Node headers are needed to build it.
#import <AppKit/AppKit.h>
#include <stddef.h>
#include <stdint.h>

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env env, napi_callback_info info);
extern napi_status napi_create_function(napi_env env, const char *name, size_t length, napi_callback cb, void *data,
                                        napi_value *result);

static napi_value tick(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  [[NSHapticFeedbackManager defaultPerformer] performFeedbackPattern:NSHapticFeedbackPatternLevelChange
                                                     performanceTime:NSHapticFeedbackPerformanceTimeNow];
  return NULL;
}

__attribute__((visibility("default"))) int32_t node_api_module_get_api_version_v1(void) { return 8; }

__attribute__((visibility("default"))) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "tick", SIZE_MAX, tick, NULL, &fn) != 0) return exports;
  return fn;
}
