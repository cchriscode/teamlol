import { HeroSearch } from './hero-search';

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-meta">PATCH 16.10 · KR</div>
        <h1 className="hero-title">소환사명을 검색하세요</h1>
        <HeroSearch />
        <div className="hero-hint">예시: Hide on bush#KR1 · Chovy#KR1</div>
      </section>
    </>
  );
}
