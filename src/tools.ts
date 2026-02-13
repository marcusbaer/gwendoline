export function internalUtcTime() {
  const now = new Date();
  const data = {
    time: now.toISOString(),
    timestamp: now.getTime(),
  };
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export const availableFunctions = {
  internalUtcTime,
};

export default availableFunctions;
