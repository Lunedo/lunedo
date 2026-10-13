export async function readText(chunks: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const chunk of chunks) text += chunk;
  return text;
}
