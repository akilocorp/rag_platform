// Network reads can split a JSON record (or a UTF-8 character) anywhere.
export async function* readNdjson(reader) {
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.trim()) yield JSON.parse(line);
      }
      if (done) {
        if (pending.trim()) yield JSON.parse(pending);
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
