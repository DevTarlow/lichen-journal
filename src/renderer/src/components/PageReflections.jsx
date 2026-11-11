import React, { useEffect, useRef } from 'react';
import { formatTime } from '../lib/dates.js';
import { QuoteIcon } from './Icons.jsx';

export default function PageReflections({ reflections = [], onEdit }) {
  const listRef = useRef(null);
  const lastIdRef = useRef(null);
  const items = Array.isArray(reflections) ? reflections : [];
  const count = items.length;
  const lastId = count > 0 ? items[count - 1].id : null;

  useEffect(() => {
    if (!count || lastIdRef.current === lastId) return;
    lastIdRef.current = lastId;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [count, lastId]);

  if (!count) return null;

  return (
    <section className="page-reflections" aria-label="Saved reflections">
      <div className="page-reflections-head">
        <span className="section-label">
          <QuoteIcon size={13} />
          Reflections
        </span>
        <span className="page-reflections-count">{count} saved</span>
      </div>

      <ol className="page-reflection-list" ref={listRef}>
        {items.map((item) => {
          const edited = Boolean(
            item.updatedAt && item.createdAt && item.updatedAt !== item.createdAt
          );
          const stamp = item.updatedAt ? formatTime(item.updatedAt) : '';
          return (
            <li key={item.id} className="page-reflection">
              <blockquote className="page-reflection-question">{item.question}</blockquote>
              <p className="page-reflection-answer">{item.answer}</p>
              <div className="page-reflection-meta">
                <span>
                  {edited ? 'Edited' : 'Saved'}
                  {stamp ? ` ${stamp}` : ''}
                </span>
                {typeof onEdit === 'function' ? (
                  <button
                    type="button"
                    className="text-button page-reflection-edit"
                    onClick={() => onEdit(item)}
                  >
                    Edit answer
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
