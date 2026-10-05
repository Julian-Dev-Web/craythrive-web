export default async function stopServer() {
  // Windows process-tree termination can stall with npm shell wrappers.
  await fetch('http://127.0.0.1:4175/__qa_shutdown', { method: 'POST' }).catch(() => {});
}
