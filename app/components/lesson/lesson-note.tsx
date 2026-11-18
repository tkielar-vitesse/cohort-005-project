import { useState, useEffect } from "react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";
import type { Route } from "../../routes/+types/courses.$slug.lessons.$lessonId";
import { describeNoteDraft, type NoteDraft } from "~/modules/lesson-notes";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { NotebookPen, Lock } from "lucide-react";
import { cn, formatRelativeTime } from "~/lib/utils";

type SavedNote = Route.ComponentProps["loaderData"]["note"];

// Laid out like the Questions & Discussion card below it, so the two read as
// one set of lesson tools.
export function LessonNote({ note }: { note: SavedNote }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [body, setBody] = useState(note?.body ?? "");
  const draft = describeNoteDraft(body, note?.body ?? null);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) toast.error(fetcher.data.error);
    else if (fetcher.data.ok) toast.success("Note saved");
  }, [fetcher.state, fetcher.data]);

  return (
    <Card className="mb-8">
      <CardContent>
        <NoteHeader />
        <fetcher.Form method="post" className="space-y-2">
          <input type="hidden" name="intent" value="save-note" />
          <Textarea
            name="body"
            rows={6}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Jot down what you want to remember from this lesson..."
            aria-label="Your notes"
            className="resize-y"
          />
          <NoteFooter
            note={note}
            draft={draft}
            isSaving={fetcher.state !== "idle"}
          />
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

function NoteHeader() {
  return (
    <div className="mb-4 flex items-center gap-2">
      <NotebookPen className="size-5 text-primary" />
      <h2 className="text-xl font-semibold">Your notes</h2>
      <span className="ml-auto flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <Lock className="size-3" />
        Private
      </span>
    </div>
  );
}

function NoteFooter({
  note,
  draft,
  isSaving,
}: {
  note: SavedNote;
  draft: NoteDraft;
  isSaving: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={isSaving || !draft.canSave}>
          {isSaving ? "Saving..." : "Save note"}
        </Button>
        <span
          suppressHydrationWarning
          className="text-xs text-muted-foreground"
        >
          {draft.unsaved
            ? "Unsaved changes"
            : note && `Saved ${formatRelativeTime(note.updatedAt)}`}
        </span>
        <span
          className={cn(
            "ml-auto text-xs",
            draft.tooLong ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {draft.length} / {draft.limit}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Only you can read your notes. Find them all on your{" "}
        <Link to="/saved" className="underline hover:text-foreground">
          Saved page
        </Link>
        .
      </p>
    </>
  );
}
