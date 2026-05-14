# JobLens（Chrome 扩展）

在 Boss 直聘等网页侧栏提供 AI 协同的求职决策辅助（Manifest V3）。本仓库为**源码**，需自行在 Chrome 中「加载已解压的扩展」使用。

本地项目文件夹建议命名为 **`joblens`**（与 npm 包名一致）。若你改过文件夹路径，请到 `chrome://extensions/` 重新「加载已解压的扩展程序」并指向新目录。

## 使用前准备

1. **Chrome 浏览器**（或 Edge 等 Chromium 内核浏览器）。
2. **DeepSeek API Key**（或其他在 `background.js` 中配置的兼容接口；以你实际代码为准）。也可在侧栏填写 Key，见下文配置。

---

## 一、把项目放到 GitHub（小白可按顺序做）

### 第 0 步：注册 GitHub

1. 打开 [https://github.com](https://github.com) 注册账号并登录。

### 第 1 步：安装 Git（二选一）

**方式 A（推荐新手）：安装 [GitHub Desktop](https://desktop.github.com/)**

- 安装后登录 GitHub 账号，图形界面即可完成「提交、推送」，不必记命令。

**方式 B：安装 [Git for Windows](https://git-scm.com/download/win)**

- 安装时一路 Next 即可；装好后**重新打开**终端或 Cursor，再试输入 `git --version`，能显示版本号即成功。

> 若命令行提示找不到 `git`，说明未安装或未加入 PATH，请用方式 A，或重装 Git 并重启电脑。

### 第 2 步：在 GitHub 上新建空仓库

1. 登录 GitHub → 右上角 **+** → **New repository**。
2. **Repository name** 填例如：`joblens`（可自定）。
3. 选 **Public**（公开，别人才能直接看到和使用）。
4. **不要**勾选 “Add a README”（先保持空仓库，避免和本地第一次推送冲突）。
5. 点 **Create repository**。页面会显示后续命令，可先不管，继续下面「本地」操作。

### 第 3 步：用 GitHub Desktop 推送（适合小白）

1. 打开 **GitHub Desktop** → **File** → **Add Local Repository**。
2. 点 **Choose…**，选中你电脑上的文件夹：`joblens`（即包含 `manifest.json` 的那一层）。
3. 若提示「不是 Git 仓库」，点 **create a repository**，**Name** 与 GitHub 上仓库名一致，**Local Path** 选到上一级目录，保证子文件夹名正确，再创建。
4. 左下角 **Summary** 写一句说明，例如：`Initial commit` → 点 **Commit to main**。
5. 菜单 **Repository** → **Repository settings…** → **Remote** → **Primary remote repository** 填你的仓库地址（在 GitHub 仓库页点绿色 **Code** 复制 HTTPS，形如 `https://github.com/你的用户名/joblens.git`）。
6. 点 **Publish repository**（或 **Push origin**），等待上传完成。

完成后，在浏览器打开你的 GitHub 仓库页，应能看到所有文件（**不应**看到 `secrets.js`，见下文安全说明）。

### 第 4 步：若你更想用命令行（已安装 Git 时）

在 **Cursor 终端**或 **PowerShell** 中执行（把地址改成你自己的仓库）：

```powershell
cd "d:\Users\86133\Desktop\joblens"
git init
git branch -M main
git add .
git status
```

确认 **`secrets.js` 不会出现在待提交列表里**（本仓库已在 `.gitignore` 中忽略它）。若你曾把密钥写进别的文件名，不要 `git add` 那些文件。

```powershell
git commit -m "Initial commit"
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

第一次 `git push` 时 GitHub 会要求登录（浏览器或 Token），按提示操作即可。

---

## 二、别人（或你自己另一台电脑）怎么安装扩展

1. 从 GitHub **Code → Download ZIP** 解压，或 `git clone` 本仓库。
2. Chrome 打开 `chrome://extensions/`。
3. 打开右上角 **开发者模式**。
4. 点 **加载已解压的扩展程序**，选择解压/克隆后的文件夹（**必须**包含根目录的 `manifest.json` 的那一层）。
5. 固定扩展图标后，在支持的招聘站点打开页面，按扩展说明打开侧栏使用。

---

## 三、配置 API Key（不要泄露到 GitHub）

1. 复制 `secrets.example.js` 为同目录下的 **`secrets.js`**。
2. 在 `secrets.js` 中填入 `LOCAL_DEEPSEEK_API_KEY`（及需要的模型名，见文件内注释）。
3. **`secrets.js` 已被 `.gitignore` 忽略，不要删除 `.gitignore`，也不要把真实 Key 贴进 Issue/讨论区。**

可选：若你为「体验用户」提供内置 Key，可参考 `jobflow-default-api.example.js` 复制为 `jobflow-default-api.js` 并阅读其中安全提示。**含真实 Key 的 `jobflow-default-api.js` 不要提交到公开仓库。**

修改 `background.js` 或 `manifest.json` 后，建议在 `chrome://extensions/` 里移除扩展再重新「加载已解压」，以免旧 Service Worker 缓存。

---

## 四、要不要单独做「产品官网」？

**不必须。** 有本 README + 几张截图，就足够让别人从 GitHub 安装使用。若以后想做宣传页，可使用 GitHub Pages 或任意静态托管，链回本仓库即可。

---

## 仓库结构（简要）

| 文件/目录 | 说明 |
|-----------|------|
| `manifest.json` | 扩展清单（入口） |
| `background.js` | 后台脚本（含 API 调用逻辑） |
| `content.js` | 内容脚本 |
| `sidepanel.html` / `sidepanel.js` | 侧栏界面 |
| `secrets.example.js` | 本地密钥模板（复制为 `secrets.js`） |
| `demo/`、`joblens-sidepanel/` | 其他实验/子项目，与根目录扩展可并存 |

---

## 许可证

若你希望他人可自由使用与修改，请在仓库根目录添加 `LICENSE` 文件（例如 MIT）。在 GitHub 新建仓库时也可勾选模板；或到 [choosealicense.com](https://choosealicense.com/) 选一种复制进来。
