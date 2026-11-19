// Retry only the rename of a fully written temporary file when its handle is
// briefly held open. Permanent failures still surface after the bounded delay.
const sharingErrors = new Set(['EPERM', 'EACCES', 'EBUSY']);
const retryDelays = [15, 30, 60, 120, 240];

export async function replaceFileWithRetry(renameFile, source, destination) {
  for (let attempt = 0; ; attempt++) {
    try {
      await renameFile(source, destination);
      return;
    } catch (error) {
      if (!sharingErrors.has(error?.code) || attempt >= retryDelays.length) throw error;
      await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
    }
  }
}
