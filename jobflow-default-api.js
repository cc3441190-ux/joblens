/**
 * 产品分发用：为「没有自有 DeepSeek Key」的用户提供默认可用 API。
 *
 * 用法：
 * 1. 在本文件双引号中填入 `JOBFLOW_DEFAULT_SHARED_DEEPSEEK_API_KEY`（与 secrets.js 二选一或并存；优先级见 background.js）。
 * 2. 模型可留空，则与全局默认 `deepseek-v4-flash` 一致。
 *
 * 安全与成本提示：
 * - Key 会随 .crx / 解压扩展暴露，任何人可提取；请使用独立子账号、设额度、勿与主站 Key 混用。
 * - 更稳妥的长期方案是自建后端代理，由服务端持有密钥。
 */
var JOBFLOW_DEFAULT_SHARED_DEEPSEEK_API_KEY = "";
var JOBFLOW_DEFAULT_SHARED_DEEPSEEK_MODEL = "";
