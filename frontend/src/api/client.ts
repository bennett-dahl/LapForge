const BASE = '';

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    let msg: string;
    try {
      msg = JSON.parse(text).error ?? text;
    } catch {
      msg = text;
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body);
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PATCH', path, body);
}

export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, body);
}

export function apiDelete<T = { ok: boolean }>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}

export async function apiUpload<T>(
  path: string,
  formData: FormData,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body: formData,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const text = await res.text();
    let msg: string;
    try {
      msg = JSON.parse(text).error ?? text;
    } catch {
      msg = text;
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export type UploadProgressHandlers = {
  onProgress?: (loaded: number, total: number) => void;
  /** Fired when the request body has been fully sent (waiting on server response). */
  onUploadComplete?: () => void;
};

/** POST multipart form with XMLHttpRequest so upload progress can be reported. */
export function apiUploadWithProgress<T>(
  path: string,
  formData: FormData,
  handlers?: UploadProgressHandlers,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}${path}`);
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && handlers?.onProgress) {
        handlers.onProgress(e.loaded, e.total);
      }
    });
    xhr.upload.addEventListener('load', () => {
      handlers?.onUploadComplete?.();
    });

    xhr.addEventListener('load', () => {
      const text = xhr.responseText;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(text) as T);
        } catch {
          reject(new Error('Invalid JSON response'));
        }
        return;
      }
      let msg: string;
      try {
        msg = JSON.parse(text).error ?? text;
      } catch {
        msg = text || `HTTP ${xhr.status}`;
      }
      reject(new Error(msg));
    });
    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
    xhr.send(formData);
  });
}
