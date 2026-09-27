import { cn } from "#ui";

interface LogoProps {
  className?: string;
  rounded?: boolean;
}

export function Logo({ className }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlSpace="preserve"
      viewBox="0 0 48 48"
      className={cn(className)}
      fillRule="evenodd"
      clipRule="evenodd"
      strokeLinejoin="round"
      strokeMiterlimit={2}
      fill="currentColor"
    >
      <path d="M0 13h11v11H0z" transform="translate(27 -18.273)scale(1.6364)" />
      <path d="M0 4h10v10h10v10H0z" transform="matrix(1.8 0 0 1.8 3 1.8)" />
    </svg>
  );
}
