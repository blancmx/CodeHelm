process.stdout.write('CODEHELM_E2E_SERVICE_READY\n');

const heartbeat = setInterval(() => {
  process.stdout.write('CODEHELM_E2E_SERVICE_HEARTBEAT\n');
}, 1_000);

const stop = () => {
  clearInterval(heartbeat);
  process.stdout.write('CODEHELM_E2E_SERVICE_STOPPED\n');
  process.exit(0);
};

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
