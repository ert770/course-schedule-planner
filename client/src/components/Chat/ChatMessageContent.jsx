const headingPattern = /^#{1,6}\s+(.+)$/u;
const bulletPattern = /^[-*•]\s+(.+)$/u;
const numberedPattern = /^(\d+)(?:[.)]\s+|、\s*)(.+)$/u;

function renderInline(text) {
  return text.split(/(\*\*[^*\n]+\*\*)/u).map((part, index) => (
    index % 2 === 0 ? part : <strong key={index}>{part.slice(2, -2)}</strong>
  ));
}

export default function ChatMessageContent({ text }) {
  const blocks = [];
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const previous = blocks.at(-1);
    const heading = line.match(headingPattern);
    const bullet = line.match(bulletPattern);
    const numbered = line.match(numberedPattern);

    if (!line) {
      if (previous) previous.closed = true;
    } else if (heading) {
      blocks.push({ type: 'heading', text: heading[1] });
    } else if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      const item = bullet ? bullet[1] : numbered[2];
      if (previous?.type === type && !previous.closed) {
        previous.items.push(item);
      } else {
        blocks.push({ type, items: [item], start: numbered ? Number(numbered[1]) : undefined });
      }
    } else if (previous?.type === 'paragraph' && !previous.closed) {
      previous.text += '\n' + line;
    } else {
      blocks.push({ type: 'paragraph', text: line });
    }
  }

  return (
    <div className="chat-message-content">
      {blocks.map((block, index) => {
        if (block.type === 'heading') return <h4 key={index}>{renderInline(block.text)}</h4>;
        if (block.type === 'paragraph') return <p key={index}>{renderInline(block.text)}</p>;
        const List = block.type;
        return (
          <List key={index} start={block.start}>
            {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
          </List>
        );
      })}
    </div>
  );
}
