"use client";
import { useEffect } from 'react';

export default function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // avoid dev HMR conflicts
      const isLocalhost = Boolean(
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '::1'
      );
      const swUrl = '/sw.js';
      window.addEventListener('load', () => {
        navigator.serviceWorker.register(swUrl).catch(() => {
          // silent fail
        });
      });
    }
  }, []);
  return null;
}
