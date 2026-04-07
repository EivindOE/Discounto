import { Button } from "@shopify/polaris";

type InternalRouteButtonProps = {
  to: string;
  children: string;
  variant?: "primary" | "secondary";
  dataTestId?: string;
};

export function InternalRouteButton({
  to,
  children,
  variant = "secondary",
  dataTestId,
}: InternalRouteButtonProps) {
  return (
    <Button
      url={to}
      variant={variant}
      accessibilityLabel={children}
      id={dataTestId}
    >
      {children}
    </Button>
  );
}
