# 来源业务约定
当前已运行的业务范围：分单位收集联合持有人材料，各自确认，选择或更换代表，回读并汇总门户草稿，按门户受理号提交或补正。
以下约定描述合作源接口及其返回含义，不表示工作台已经办理了所有来源状态。
## `GET /applications/:id`
返回holders、shares、representative、materials及applicationRevision。份额合计为100时才是可办理的名单；名单变化体现在新的applicationRevision。
## `POST /confirmations`
记录holder、seenRevision及其确认内容。确认只对当时看到的名单、份额和该持有人自己的资料版本有效，因此同时携带`seenHolders`、`seenMaterials`。
来源返回`confirmation`、`holder`、`application`、`seenRevision`、`confirmed`。`holder`、`application`与请求不符，或`confirmed`为假时，该确认不能用于报送。来源明确拒绝（400/409/422）只影响该持有人。
## `GET /portal/drafts/:id`
返回canOperate、ownerApplication、attachments和acceptedReceipt；受理后只能补正。`canOperate`必须为布尔值，`ownerApplication`和`attachments`必须存在，否则视为回读不完整，不能作为办理依据。
## `POST /portal/drafts/:id/corrections`
仅在回读已显示受理号时使用；正文包含`holder`、`content`与`ordinal`，返回补正记录。
## 本地传输
本地来源按请求方法和路径匹配，查询和正文不参与路由匹配。响应脚本只负责返回来源原始数据，不替工作台判断业务是否完成。`delayMs` 为本次响应延迟，`disconnect` 表示未返回确定响应便断开连接，`status` 为 HTTP 状态；记录顺序与实际请求一致。来源实例独享响应进度，重新启动恢复第一条。
业务标识区分大小写；金额为最小货币单位的整数，时间为本地来源统一的整数秒。样例中的身份、合同和公司均为合成资料，不是外部系统账号。

## 本地可读资源
`POST /confirmations` 返回该资源的合成业务资料；正常样例中的身份与主领取记录一致。
`GET /portal/drafts/D1` 返回该资源的合成业务资料；正常样例中的身份与主领取记录一致。

来源路径可包含具名段，按段匹配。`requireBody` 与 `requireQuery` 可限制业务范围，不符合时返回409且不推进响应序列；`requireAuthentication` 表示该路由要求授权。`GET /counters` 只返回来源处理次数，不参与收件决策。
