import styles from "./Button.module.css";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "muted" | "card";
type ButtonSize = "sm" | "md";

interface BaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isDisabled?: boolean;
  isSelected?: boolean;
  children: React.ReactNode;
  className?: string;
}

interface ButtonElementProps extends BaseProps {
  href?: never;
  onClick?: () => void;
  type?: "button" | "submit";
}

interface AnchorElementProps extends BaseProps {
  href: string;
  target?: string;
  rel?: string;
}

type ButtonProps = ButtonElementProps | AnchorElementProps;

export default function Button(props: ButtonProps) {
  const { variant = "primary", size = "md", isDisabled, isSelected, children, className } = props;
  const cls = [styles.button, styles[variant], styles[size], isSelected ? styles.selected : undefined, className]
    .filter(Boolean)
    .join(" ");

  if ("href" in props && props.href !== undefined) {
    return (
      <a
        href={props.href}
        target={props.target}
        rel={props.rel}
        className={cls}
        aria-disabled={isDisabled || undefined}
      >
        {children}
      </a>
    );
  }

  const { onClick, type = "button" } = props as ButtonElementProps;
  return (
    <button type={type} onClick={onClick} disabled={isDisabled} className={cls}>
      {children}
    </button>
  );
}
