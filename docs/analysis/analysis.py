# -*- coding: utf-8 -*-
"""
实验三 数据分析脚本
数据：教师提供的 V2.0 模拟运行数据（只读，不修改）
输出：figs/*.png、metrics.json 与若干 csv，供实验报告引用
运行：python analysis.py
"""
import os, json
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

BASE = os.path.dirname(os.path.abspath(__file__))
# 数据目录：优先环境变量 CAS_DATA，其次项目内 ../data，最后与项目同级的“项目数据/data”
_candidates = [
    os.environ.get("CAS_DATA", ""),
    os.path.join(BASE, "..", "..", "项目数据", "data"),
    os.path.join(BASE, "..", "..", "..", "项目数据", "data"),
]
DATA = next((c for c in _candidates if c and os.path.isdir(c)), _candidates[1])
FIG = os.path.join(BASE, "figs")
os.makedirs(FIG, exist_ok=True)

for fnt in ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf"]:
    if os.path.exists(fnt):
        font_manager.fontManager.addfont(fnt)
        plt.rcParams["font.family"] = font_manager.FontProperties(fname=fnt).get_name()
        break
plt.rcParams["axes.unicode_minus"] = False
plt.rcParams["figure.dpi"] = 150
plt.rcParams["savefig.bbox"] = "tight"

act = pd.read_csv(os.path.join(DATA, "activity.csv"), encoding="utf-8-sig",
                  parse_dates=["registration_open", "activity_start"])
reg = pd.read_csv(os.path.join(DATA, "registration_log.csv"), encoding="utf-8-sig",
                  parse_dates=["request_ts"])
wl = pd.read_csv(os.path.join(DATA, "waitlist_log.csv"), encoding="utf-8-sig",
                 parse_dates=["change_ts"])
fb = pd.read_csv(os.path.join(DATA, "feedback.csv"), encoding="utf-8-sig",
                 parse_dates=["submit_ts"])
ub = pd.read_csv(os.path.join(DATA, "user_behavior.csv"), encoding="utf-8-sig",
                 parse_dates=["event_ts"])
sl = pd.read_csv(os.path.join(DATA, "system_log.csv"), encoding="utf-8-sig",
                 parse_dates=["event_ts"])

M = {}

# ---------- 1. 报名结果构成 ----------
ap = reg[reg.action == "apply"]
cnt = ap.result.value_counts()
M["apply_total"] = int(len(ap))
M["result_counts"] = {k: int(v) for k, v in cnt.items()}
M["result_pct"] = {k: round(v / len(ap) * 100, 2) for k, v in cnt.items()}

order = ["accepted", "waitlisted", "duplicate", "capacity_conflict", "server_error"]
label_cn = {"accepted": "直接确认", "waitlisted": "进入候补", "duplicate": "重复提交",
            "capacity_conflict": "名额冲突", "server_error": "服务端错误"}
vals = [cnt.get(k, 0) for k in order]
colors = ["#4a7fb5", "#e0a33a", "#c05b5b", "#9b7bb8", "#7f7f7f"]

fig, ax = plt.subplots(figsize=(7, 3.6))
bars = ax.barh([label_cn[k] for k in order][::-1], vals[::-1], color=colors[::-1])
for b, v in zip(bars, vals[::-1]):
    ax.text(v + 10, b.get_y() + b.get_height() / 2, f"{v}（{v/len(ap)*100:.1f}%）",
            va="center", fontsize=9)
ax.set_xlabel("报名申请请求数")
ax.set_title(f"V2.0 报名申请的处理结果（n={len(ap)}）")
ax.set_xlim(0, max(vals) * 1.25)
fig.savefig(os.path.join(FIG, "fig1_apply_result.png"))
plt.close(fig)

# ---------- 2. 候补转化与等待时长 ----------
first = wl.sort_values("change_ts").groupby("application_id").first()
acc_ts = wl[wl.new_status == "accepted"].groupby("application_id")["change_ts"].first()
w = first[first.new_status == "waiting"].copy()
w["accepted_ts"] = acc_ts.reindex(w.index)
w["converted"] = w.accepted_ts.notna()
wait_h = (w.accepted_ts - w.change_ts).dt.total_seconds() / 3600
M["waitlist_total"] = int(len(w))
M["waitlist_converted"] = int(w.converted.sum())
M["waitlist_conv_rate"] = round(w.converted.mean() * 100, 2)
M["wait_hours_median"] = round(float(wait_h.median()), 2)
M["wait_hours_p90"] = round(float(wait_h.quantile(0.9)), 2)

fig, axes = plt.subplots(1, 2, figsize=(10, 3.6))
ax = axes[0]
stages = ["进入候补", "转为已确认"]
vals2 = [len(w), int(w.converted.sum())]
bars = ax.bar(stages, vals2, color=["#e0a33a", "#4a7fb5"], width=0.55)
for b, v in zip(bars, vals2):
    ax.text(b.get_x() + b.get_width() / 2, v + 12, str(v), ha="center", fontsize=10)
ax.set_ylim(0, len(w) * 1.15)
ax.set_ylabel("申请数")
ax.set_title(f"候补转化：{w.converted.mean()*100:.1f}% 最终转正")

ax = axes[1]
ax.hist(wait_h.dropna(), bins=15, color="#4a7fb5", edgecolor="white")
ax.axvline(wait_h.median(), color="#c05b5b", ls="--", lw=1.4)
ax.text(wait_h.median() + 1, ax.get_ylim()[1] * 0.85,
        f"中位数 {wait_h.median():.1f} 小时", color="#c05b5b", fontsize=9)
ax.set_xlabel("从进入候补到转正的等待时长（小时）")
ax.set_ylabel("申请数")
ax.set_title("转正等待时长分布")
fig.savefig(os.path.join(FIG, "fig2_waitlist.png"))
plt.close(fig)

# ---------- 3. 各活动申请量 / 容量 ----------
g = ap.groupby("activity_id").agg(applies=("request_id", "count"),
                                 accepted=("result", lambda s: (s == "accepted").sum()),
                                 waitlisted=("result", lambda s: (s == "waitlisted").sum()),
                                 dup=("result", lambda s: (s == "duplicate").sum()),
                                 conflict=("result", lambda s: (s == "capacity_conflict").sum()))
g = g.join(act.set_index("activity_id")[["activity_name", "category", "capacity"]])
g["over"] = g.applies - g.capacity
g = g.sort_values("applies", ascending=False)
g.to_csv(os.path.join(BASE, "activity_heat.csv"), encoding="utf-8-sig")
M["activities"] = int(len(g))
M["activities_full"] = int((g.accepted >= g.capacity).sum())
M["applies_median"] = float(g.applies.median())
M["capacity_median"] = float(g.capacity.median())

top = g.head(12).iloc[::-1]
fig, ax = plt.subplots(figsize=(8, 4.6))
ax.barh(top["activity_name"], top["applies"], color="#d9d9d9", label="报名申请")
ax.barh(top["activity_name"], top["capacity"], color="#4a7fb5", label="名额")
ax.set_xlabel("人数 / 申请数")
ax.set_title("申请量前 12 的活动：申请数普遍远超名额")
ax.legend(loc="lower right", fontsize=8)
fig.savefig(os.path.join(FIG, "fig3_activity_heat.png"))
plt.close(fig)

# ---------- 4. 请求时点分布 ----------
hourly = reg.assign(h=reg.request_ts.dt.hour).groupby("h").size().reindex(range(24), fill_value=0)
M["peak_hours"] = [int(hourly.idxmax()), int(hourly.sort_values(ascending=False).index[1])]
M["peak_share"] = round(hourly.max() / len(reg) * 100, 2)

fig, ax = plt.subplots(figsize=(8, 3.2))
ax.bar(hourly.index, hourly.values, color=["#c05b5b" if h in (9, 18) else "#9ec3e0" for h in hourly.index])
ax.set_xticks(range(0, 24, 2))
ax.set_xlabel("请求时刻（小时）")
ax.set_ylabel("业务请求数")
ax.set_title("报名/取消请求的时点分布：09:00 与 18:00 两个尖峰")
ax.annotate(f"09:00 共 {hourly[9]} 次", xy=(9, hourly[9]), xytext=(11, hourly[9] * 0.92),
            arrowprops=dict(arrowstyle="->", color="#c05b5b"), fontsize=9, color="#c05b5b")
fig.savefig(os.path.join(FIG, "fig4_hourly.png"))
plt.close(fig)

# ---------- 5. 处理耗时 ----------
lat = reg.groupby("result").latency_ms.agg(["count", "median", "mean",
                                            lambda s: s.quantile(0.95)]).round(1)
lat.columns = ["n", "median", "mean", "p95"]
lat.to_csv(os.path.join(BASE, "latency.csv"), encoding="utf-8-sig")
M["latency_overall_p50"] = float(reg.latency_ms.median())
M["latency_overall_p95"] = float(reg.latency_ms.quantile(0.95))
M["latency_conflict_p50"] = float(reg[reg.result == "capacity_conflict"].latency_ms.median())
M["latency_accept_p50"] = float(reg[reg.result == "accepted"].latency_ms.median())
M["slow_warn"] = int((sl.event_code == "SLOW_REQUEST").sum())

fig, ax = plt.subplots(figsize=(7, 3.2))
cats = ["accepted", "duplicate", "waitlisted", "capacity_conflict"]
data = [reg[reg.result == c].latency_ms for c in cats]
ax.boxplot(data, tick_labels=[label_cn[c] for c in cats], showfliers=False, widths=0.55)
ax.set_ylabel("处理耗时（毫秒）")
ax.set_title("不同处理结果的处理耗时：满员/名额冲突场景明显更慢")
for i, c in enumerate(cats):
    ax.text(i + 1, reg[reg.result == c].latency_ms.median() + 40,
            f"{reg[reg.result == c].latency_ms.median():.0f}", ha="center", fontsize=9, color="#c05b5b")
fig.savefig(os.path.join(FIG, "fig5_latency.png"))
plt.close(fig)

# ---------- 6. 反馈主题 ----------
THEME = [
    ("候补与状态变化不可追踪", ["候补", "排队", "状态", "登录后才知道", "结果的变化"]),
    ("提交结果不确定/重复点击", ["点了两次", "又点了一次", "不确定", "转了一会儿", "卡住", "没有弄清楚原因"]),
    ("难以发现合适活动", ["标题看着差不多", "逐个看", "查起来", "翻了几轮", "想找周末", "只想参加一类"]),
    ("地点/时间等细节信息", ["地点说明", "海报", "时间和课程冲突"]),
]
def theme_of(t):
    for name, kws in THEME:
        if any(k in str(t) for k in kws):
            return name
    return "正面反馈/无明确诉求"
fb["theme"] = fb.feedback_text.map(theme_of)
tc = fb.theme.value_counts()
tc.to_csv(os.path.join(BASE, "feedback_themes.csv"), encoding="utf-8-sig")
M["feedback_total"] = int(len(fb))
M["feedback_themes"] = {k: int(v) for k, v in tc.items()}
M["feedback_theme_pct"] = {k: round(v / len(fb) * 100, 1) for k, v in tc.items()}

fig, ax = plt.subplots(figsize=(8, 3.4))
t2 = tc.iloc[::-1]
cl = ["#c05b5b" if ("候补" in i or "提交" in i) else ("#e0a33a" if "发现" in i else "#b9c9d6") for i in t2.index]
ax.barh(t2.index, t2.values, color=cl)
for i, (name, v) in enumerate(zip(t2.index, t2.values)):
    ax.text(v + 0.3, i, f"{v}", va="center", fontsize=9)
ax.set_xlabel("反馈条数")
ax.set_xlim(0, t2.max() * 1.18)
ax.set_title(f"{len(fb)} 条匿名反馈的主题分布（按关键词归类）")
fig.savefig(os.path.join(FIG, "fig6_feedback.png"))
plt.close(fig)

# ---------- 7. 行为与设备 ----------
M["behav_list"] = int((ub.event_name == "list_view").sum())
M["behav_detail"] = int((ub.event_name == "detail_view").sum())
M["behav_status"] = int((ub.event_name == "status_view").sum())
M["behav_reg"] = int((ub.event_name == "registration_page_view").sum())
M["detail_per_list"] = round(M["behav_detail"] / M["behav_list"], 2)
dev = ub.device.value_counts()
M["device"] = {str(k): int(v) for k, v in dev.items()}
M["mobile_share"] = round(dev.get("mobile", 0) / dev.sum() * 100, 1)

fig, ax = plt.subplots(figsize=(8, 3.2))
pages = ["list_view", "detail_view", "registration_page_view", "status_view"]
cn = ["列表页", "详情页", "报名页", "报名状态页"]
vv = [M["behav_list"], M["behav_detail"], M["behav_reg"], M["behav_status"]]
bars = ax.bar(cn, vv, color=["#9ec3e0", "#4a7fb5", "#7fb58a", "#e0a33a"], width=0.55)
for b, v in zip(bars, vv):
    ax.text(b.get_x() + b.get_width() / 2, v + 60, str(v), ha="center", fontsize=10)
ax.set_ylabel("埋点事件数")
ax.set_title("页面访问量：详情页被反复打开，状态页被多次查看")
fig.savefig(os.path.join(FIG, "fig7_pages.png"))
plt.close(fig)

# ---------- 8. 重复提交与服务端错误 ----------
dup = reg[reg.result == "duplicate"]
M["dup_total"] = int(len(dup))
M["dup_retry_yes"] = int((dup.client_retry == 1).sum())
M["server_error"] = int((reg.result == "server_error").sum())
M["e409"] = int((sl.event_code == "E409").sum())
M["e500"] = int((sl.event_code == "E500").sum())
M["reg_total"] = int(len(reg))
M["error_rate"] = round((M["server_error"] / M["apply_total"]) * 100, 2)

with open(os.path.join(BASE, "metrics.json"), "w", encoding="utf-8") as f:
    json.dump(M, f, ensure_ascii=False, indent=2)

print(json.dumps(M, ensure_ascii=False, indent=1))
print("\n图表：", sorted(os.listdir(FIG)))
