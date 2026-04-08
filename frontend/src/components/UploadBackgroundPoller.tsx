import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { apiGet } from '../api/client';
import { useUploadProgress } from '../contexts/UploadProgressContext';
import type { UploadTaskStatus } from '../types/api';

function parseSessionIdFromRedirect(redirect: string): string | null {
  const match = redirect.match(/\/sessions\/(.+)/);
  return match ? match[1] : null;
}

export default function UploadBackgroundPoller() {
  const { phase, taskId, updateTaskStatus, resetAfterSuccess, failProcessing } =
    useUploadProgress();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  useEffect(() => {
    if (phase !== 'processing' || !taskId) return;

    const iv = setInterval(async () => {
      if (taskIdRef.current !== taskId) return;
      try {
        const status = await apiGet<UploadTaskStatus>(`/api/upload-status/${taskId}`);
        if (taskIdRef.current !== taskId) return;

        if (status.done && status.error) {
          clearInterval(iv);
          failProcessing(status.error);
          return;
        }
        if (status.done && status.redirect) {
          clearInterval(iv);
          const sessionId = parseSessionIdFromRedirect(status.redirect);
          if (sessionId) {
            navigate(`/sessions/${sessionId}`);
          }
          resetAfterSuccess();
          queryClient.invalidateQueries({ queryKey: ['sessions-full'] });
          queryClient.invalidateQueries({ queryKey: ['sessions-list'] });
          return;
        }
        updateTaskStatus(status);
      } catch (e) {
        if (taskIdRef.current !== taskId) return;
        const is404 =
          e instanceof Error && (e.message.includes('404') || e.message.includes('not found'));
        if (is404) {
          clearInterval(iv);
          resetAfterSuccess();
        }
      }
    }, 1000);

    return () => clearInterval(iv);
  }, [phase, taskId, navigate, queryClient, updateTaskStatus, resetAfterSuccess, failProcessing]);

  return null;
}
