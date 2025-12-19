// Deprecated: ActivityLogPanel has been replaced by ActivityLogModal
export default function ActivityLogPanel() {
  if (process.env.NODE_ENV !== 'production') {
    // Make it obvious during development if something still imports this
    console.warn('ActivityLogPanel is deprecated. Use ActivityLogModal instead.');
  }
  return null;
}
