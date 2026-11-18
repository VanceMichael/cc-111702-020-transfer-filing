# 来源业务约定
当前已运行的业务范围：收集单持有人材料，选择代表，上传草稿并按门户受理号结束申请。
以下约定描述合作源接口及其返回含义，不表示工作台已经办理了所有来源状态。
## `GET /applications/:id`
返回holders、shares、representative、materials及applicationRevision。
## `POST /confirmations`
记录holder、seenRevision及其确认内容。
## `GET /portal/drafts/:id`
返回canOperate、ownerApplication、attachments和acceptedReceipt；受理后只能补正。
## 本地传输
本地来源按请求方法和路径匹配，查询和正文不参与路由匹配。响应脚本只负责返回来源原始数据，不替工作台判断业务是否完成。`delayMs` 为本次响应延迟，`disconnect` 表示未返回确定响应便断开连接，`status` 为 HTTP 状态；记录顺序与实际请求一致。来源实例独享响应进度，重新启动恢复第一条。
业务标识区分大小写；金额为最小货币单位的整数，时间为本地来源统一的整数秒。样例中的身份、合同和公司均为合成资料，不是外部系统账号。
