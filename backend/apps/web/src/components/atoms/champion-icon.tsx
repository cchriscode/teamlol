import { ddragon } from '@/lib/ddragon';

interface Props {
  championKey: string;
  size?: number;
  className?: string;
  alt?: string;
  version?: string;
}

export function ChampionIcon({ championKey, size = 32, className = 'champ-icon', alt, version }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ddragon.championIcon(championKey, version)}
      width={size}
      height={size}
      className={className}
      alt={alt ?? championKey}
      loading="lazy"
    />
  );
}
