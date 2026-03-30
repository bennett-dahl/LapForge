import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../api/client';
import type { UploadTaskStatus } from '../types/api';

interface TaskMap {
  [taskId: string]: UploadTaskStatus;
}

export default function BackgroundTaskBar() {
  const [tasks, setTasks] = useState<TaskMap>({});

  const poll = useCallback(async () => {
    try {
      const data = await apiGet<TaskMap>('/api/upload-tasks');
      setTasks(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, [poll]);

  const active = Object.entries(tasks).filter(([, t]) => !t.done);
  if (active.length === 0) return null;

  return (
    <div className="bg-task-bar">
      {active.map(([id, t]) => (
        <div key={id} className="bg-task-item">
          <span className="bg-task-label">{t.label || 'Processing...'}</span>
          <div className="bg-task-progress">
            <div className="bg-task-fill" style={{ width: `${t.pct}%` }} />
          </div>
          <span className="bg-task-pct">{t.pct}%</span>
        </div>
      ))}
    </div>
  );
}
