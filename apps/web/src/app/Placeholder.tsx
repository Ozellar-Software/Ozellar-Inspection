import { Body1, Title3 } from '@fluentui/react-components';
import { Link } from 'react-router-dom';

export function Placeholder({ name }: { name: string }) {
  return (
    <div style={{ padding: 16, display: 'grid', gap: 8 }}>
      <Title3>{name}</Title3>
      <Body1>To be ported from the current app. See docs/03-feature-inventory.md for the acceptance checklist.</Body1>
      <Link to="/">Back to home</Link>
    </div>
  );
}
