import React from 'react';
import './LogoRing.css';

export interface LogoRingProps {
  size?: number;
  iconSize?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function LogoRing({ size = 38, iconSize = 24, className = '', style }: LogoRingProps) {
  return (
    <div
      className={`logo-ring ${className}`}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface, #ffffff)',
        border: '1px solid rgba(241, 89, 42, 0.15)',
        borderRadius: size * 0.315, // dynamic rounded corners
        boxShadow: '0 8px 24px rgba(241, 89, 42, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04)',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        ...style,
      }}
    >
      <svg width={iconSize} height={iconSize} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="ozellar-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f1592a" />
            <stop offset="100%" stopColor="#e04e22" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="36" fill="none" stroke="url(#ozellar-grad)" strokeWidth="20" />
      </svg>
    </div>
  );
}

export interface BrandLogoProps {
  href?: string;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

export function BrandLogo({ href = '#', className = '', onClick }: BrandLogoProps) {
  return (
    <a href={href} className={`brand ${className}`} onClick={onClick}>
      <LogoRing />
      <span className="brand-text">Ozellar<span className="brand-light">Marine</span></span>
    </a>
  );
}
