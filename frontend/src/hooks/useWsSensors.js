import { useEffect, useMemo, useRef, useState } from "react";

export function useWsSensors() {
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState({});
  const [lastError, setLastError] = useState("");

  const wsUrl = useMemo(() => {
    return "wss://carwash-backend-833921043838.us-central1.run.app/ws";
  }, []);

  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    function connect() {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          retryRef.current = 0;
          setConnected(true);
          setLastError("");
        };

        ws.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (data && typeof data === "object") {
              setSnapshot(data);
            }
          } catch {}
        };

        ws.onerror = () => {
          setLastError("WebSocket error");
        };

        ws.onclose = () => {
          setConnected(false);
          if (!aliveRef.current) return;

          const n = Math.min(8, retryRef.current++);
          const delay = 2500 + n * 1500;
          setTimeout(connect, delay);
        };
      } catch (e) {
        setLastError(String(e?.message || e));
        setTimeout(connect, 3000);
      }
    }

    connect();

    return () => {
      aliveRef.current = false;
      try { wsRef.current?.close(); } catch {}
    };
  }, [wsUrl]);

  const stations = useMemo(() => Object.keys(snapshot || {}).sort(), [snapshot]);

  return { connected, snapshot, stations, lastError };
}
