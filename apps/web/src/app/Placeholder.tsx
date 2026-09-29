import { useNavigate } from 'react-router-dom';
import { BackIcon, ClipboardIcon } from '../icons';

export function Placeholder({ name }: { name: string }) {
  const nav = useNavigate();
  return (
    <>
      <div className="appbar">
        <button className="back" aria-label="Back" onClick={() => nav('/')}><BackIcon /></button>
        <div className="title-wrap"><h1>{name}</h1></div>
      </div>
      <div className="page-wrap">
        <div className="empty-state">
          <ClipboardIcon />
          <p>Not built yet.<br />See docs/03-feature-inventory.md for the acceptance checklist.</p>
        </div>
      </div>
    </>
  );
}
