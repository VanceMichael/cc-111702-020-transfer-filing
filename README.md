# 联合产权资料报送工作台
本项目用于联合持有人分单位收集材料并确认，确定或更换代表，回读并汇总门户草稿，按门户受理号提交或补正。运行环境为 Node.js 22.23.4，仅使用标准库，没有运行时安装步骤。数据均为本地合成资料，默认来源只监听回环地址，不连接真实业务网站或真实账号。
## 运行
```bash
npm run build
npm test
npm run demo
```
演示会在进程内启动实际本地 HTTP 来源，办理正常业务，打印领域结果及来源请求，然后关闭服务。端口由系统分配，数据保存在内存，不影响已启动的服务。
持续运行时先执行 `npm run source`，再在另一个终端执行 `npm start`。默认来源端口为 4101，业务端口为 4100；可通过 `SOURCE_URL`、`PORT` 和 `STATE_PATH` 指定回环来源、端口及状态文件。终止进程使用 Ctrl+C。删除 `var/` 可清空本地持久状态。
## 业务接口
`POST /collect` 接收本次办理参数，空对象使用本地样例的正常单持有人条件；`GET /state` 查询当前业务结果；`GET /health` 查询服务状态。一次办理失败不会提交中间业务状态，接口以 422 返回拒绝原因。状态文件按完整写入后替换，单进程内串行办理。
- `confirmations`：各持有人对本次办理的确认。可带 `seenHolders`、`seenMaterials`、`seenRevision` 说明确认时所依据的名单、资料版本；来源返回确认记录时也可带 `confirmation` 读取。确认只对当时的名单、份额和本人资料版本有效。
- `representation`：确定代表（字符串或 `{ representative, draft }`）。代表只汇总和提交，不能替其他持有人确认。
- `draft`：要回读的门户草稿；换代表时自动回读已登记的草稿。
- `corrections`：联系人更正（`{ holder, contact }`）或门户受理后的补正（`{ holder, content }`）。更正联系人不使确认失效；补正需同时传 `submit: true`，且门户回读已显示受理号。
- `actor` / `role`：办理人身份。`role: "representative"` 时不能替其他持有人生成新确认；只有当前代表能回读、操作门户草稿。
- `submit`：对已受理草稿执行门户补正。
办理结果同时给出 `application`、`confirmations`、`pending`、`exited`、`representativeHistory`、`drafts`、`submissions` 与 `corrections`，可从业务申请追到各家确认依据、当前代表实际能操作的草稿与门户受理状态。
来源接口的字段约定见 `docs/source-contract.md`。`fixtures/source.json` 是单持有人样例，`fixtures/joint-source.json` 是三家联合持有人样例，均可独立启动。来源 `GET /trace` 返回实际请求；脚本每条路由依次返回响应，超出后重复最后一条，可表达延迟、断连和明确拒绝。请求轨迹只记录是否带授权，不回显授权原文。
## 测试
测试覆盖联合确认依据、换代表后的门户回读、已受理补正、退出单位资料归属、单持有人兼容、来源拒绝后的回滚、并行存储更新、本地访问边界和来源请求追踪。每个测试使用临时端口与独立状态，不依赖执行顺序。构建仅检查源码语法，不获取依赖。
