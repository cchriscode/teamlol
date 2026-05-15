import { MultiSearchForm } from './multi-search-form';

export const metadata = { title: '멀티서치 — TeamLOL' };

export default function MultiPage() {
  return (
    <main className="page">
      <header className="tier-page-header">
        <div>
          <h1 className="page-title">멀티서치</h1>
          <div className="page-subtitle">여러 Riot ID를 한 번에 검색 (한 줄에 하나)</div>
        </div>
      </header>
      <MultiSearchForm />
    </main>
  );
}
