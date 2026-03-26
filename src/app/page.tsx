import { auth, signIn } from "@/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="text-center max-w-md">
        <h1 className="text-5xl font-bold mb-2">CARTED</h1>
        <p className="text-gray-500 mb-8 text-lg">
          Smart shopping list powered by your Amazon purchase history
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/dashboard" });
          }}
        >
          <button
            type="submit"
            className="bg-black text-white px-8 py-3 rounded-full text-lg font-medium hover:bg-gray-800 transition-colors"
          >
            Sign in with Google
          </button>
        </form>

        <p className="text-xs text-gray-400 mt-6">v1.0.0</p>
      </div>
    </main>
  );
}
