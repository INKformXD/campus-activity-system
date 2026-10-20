# 实验三 数据分析产物

本目录是本轮报告的复现材料，数据本身由教师提供，不随项目提交。

- `analysis.py`：分析脚本，读取 6 张 CSV，输出 `metrics.json`、`figs/*.png` 与 3 张汇总表
- `metrics.json`：报告中引用的全部数字（请求数、候补转化、耗时、反馈主题、设备分布等）
- `figs/`：报告中的图 1~图 4
- `activity_heat.csv` / `latency.csv` / `feedback_themes.csv`：按活动、处理结果、反馈主题的明细汇总

## 运行

```bash
pip install pandas matplotlib
CAS_DATA=/path/to/项目数据/data python analysis.py
```

`CAS_DATA` 指向数据包中的 `data` 目录；不设置时脚本会尝试项目上级目录的“项目数据/data”。

## 口径提醒

- 报名申请按 `registration_log` 中 `action=apply` 的请求计数（n=2748），不是人数
- 候补按 `application_id` 去重（n=876）
- 反馈主题按关键词归类，条数只用于说明问题存在，不代表用户比例
