export default function CheckoutLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center bg-success/10 px-4">
      <p className="text-sm font-medium text-muted-foreground" role="status">
        Loading checkout…
      </p>
    </div>
  );
}
