import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="max-w-md text-center">
        <span className="text-6xl font-semibold tracking-tight text-primary">404</span>
        <h1 className="mt-2 text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has moved.
        </p>
        <Button asChild size="sm" className="mt-4">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
