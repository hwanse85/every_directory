import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { Binary, CircleAlert, CircleCheck, FileOutput, X } from "lucide-react";
import { cancelCodec, type CodecJob } from "../client";
import { formatSize } from "./FileIcon";

// 창 아래에 백그라운드 인코딩·디코딩 진행률을 보여 준다. 끝난 작업은 잠시 뒤 스스로 사라진다.
export function JobBar({ onFinished }: { onFinished: (job: CodecJob) => void }) {
  const [jobs, setJobs] = useState<CodecJob[]>([]);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let remove: (() => void) | undefined;
    void listen<CodecJob>("ed-job", ({ payload }) => {
      setJobs((previous) => {
        const others = previous.filter((job) => job.id !== payload.id);
        // 끝난 작업의 늦게 도착한 진행 이벤트는 무시한다.
        const known = previous.find((job) => job.id === payload.id);
        if (known && known.state !== "running" && payload.state === "running") return previous;
        return [...others, payload].sort((a, b) => a.id - b.id);
      });
      if (payload.state !== "running") {
        onFinished(payload);
        // 성공·취소는 6초 뒤 닫고, 오류는 사용자가 닫을 때까지 남긴다.
        if (payload.state !== "error") setTimeout(() => setJobs((previous) => previous.filter((job) => job.id !== payload.id || job.state === "running")), 6000);
      }
    }).then((stop) => { if (disposed) stop(); else remove = stop; });
    return () => { disposed = true; remove?.(); };
  }, [onFinished]);
  if (!jobs.length) return null;
  return (
    <div className="job-bar" role="region" aria-label="백그라운드 작업">
      {jobs.map((job) => {
        const percent = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
        const verb = job.kind === "uuencode" ? "인코딩" : "디코딩";
        const Icon = job.state === "done" ? CircleCheck : job.state === "error" ? CircleAlert : job.kind === "uuencode" ? Binary : FileOutput;
        return (
          <div key={job.id} className={`job-item job-${job.state}`} data-job-id={job.id}>
            <Icon size={15} aria-hidden="true" />
            <span className="job-title" title={job.output ?? job.name}>
              UU {verb} · {job.name}
            </span>
            {job.state === "running" ? (
              <>
                <span className="job-progress" role="progressbar" aria-label={`${job.name} ${verb} 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                  <i style={{ width: `${job.total ? percent : 8}%` }} className={job.total ? "" : "job-waiting"} />
                </span>
                <span className="job-percent">{job.total ? `${percent}% · ${formatSize(job.done)} / ${formatSize(job.total)}` : "준비 중"}</span>
                <button className="job-cancel" onClick={() => void cancelCodec(job.id)} title="작업 취소">취소</button>
              </>
            ) : (
              <>
                <span className="job-status" role={job.state === "error" ? "alert" : "status"}>
                  {job.state === "done" ? `${verb} 완료` : job.state === "cancelled" ? "취소했습니다. 만들던 파일은 지웠습니다." : job.message}
                </span>
                <button className="icon-button job-close" aria-label="작업 알림 닫기" onClick={() => setJobs((previous) => previous.filter((item) => item.id !== job.id))}><X size={13} /></button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
