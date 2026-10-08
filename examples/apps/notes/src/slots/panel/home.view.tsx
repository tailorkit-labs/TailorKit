import { defineView } from "@tailorkit/app";
import { useState } from "preact/hooks";
import { Box, Button, Flex, Input, TextArea } from "#tailorkit";

interface Note {
  id: string;
  title: string;
  body: string;
}

const starterNotes: Note[] = [
  {
    id: "note-welcome",
    title: "Welcome note",
    body: "Capture the decision, not the whole meeting.",
  },
  {
    id: "note-follow-up",
    title: "Follow up",
    body: "Send the revised plan after todos are updated.",
  },
];

const view = defineView({ slot: "panel", view: "/", component: ViewComponent });

function ViewComponent() {
  const [notes, setNotes] = useState<Note[]>(starterNotes);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const selectedNote = notes.find((note) => note.id === selectedNoteId);

  return (
    <Box width="full" overflowWrap="anywhere">
      {selectedNote ? (
        <NoteView
          note={selectedNote}
          onBack={() => setSelectedNoteId(null)}
          onDelete={deleteNote}
          onUpdate={updateNote}
        />
      ) : (
        <NotesList notes={notes} onAdd={addNote} onSelect={setSelectedNoteId} />
      )}
    </Box>
  );

  function addNote() {
    const count = notes.length + 1;
    const note: Note = {
      id: createId("note"),
      title: `Note ${count}`,
      body: "",
    };

    setNotes((current) => [note, ...current]);
    setSelectedNoteId(note.id);
  }

  function updateNote(id: string, changes: Partial<Pick<Note, "title" | "body">>) {
    setNotes((current) => current.map((note) => (note.id === id ? { ...note, ...changes } : note)));
  }

  function deleteNote(id: string) {
    setNotes((current) => current.filter((note) => note.id !== id));
    setSelectedNoteId(null);
  }
}

function NotesList({
  notes,
  onAdd,
  onSelect,
}: {
  notes: Note[];
  onAdd: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <Flex direction="column" gap="lg">
      <Button variant="default" onClick={onAdd}>
        Add note
      </Button>

      <Flex direction="column" gap="md">
        {notes.map((note) => (
          <NoteListItem key={note.id} note={note} onSelect={onSelect} />
        ))}
      </Flex>
    </Flex>
  );
}

function NoteListItem({ note, onSelect }: { note: Note; onSelect: (id: string) => void }) {
  return (
    <Box
      background="surface"
      border="solid"
      borderColor="default"
      padding="md"
      radius="md"
      width="full"
    >
      <Flex direction="column" gap="md">
        <Box>{note.title || "Untitled note"}</Box>
        <Box>{note.body || "No note text yet."}</Box>
        <Button variant="secondary" onClick={() => onSelect(note.id)}>
          Open
        </Button>
      </Flex>
    </Box>
  );
}

function NoteView({
  note,
  onBack,
  onDelete,
  onUpdate,
}: {
  note: Note;
  onBack: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, changes: Partial<Pick<Note, "title" | "body">>) => void;
}) {
  return (
    <Flex direction="column" gap="lg">
      <Flex direction="column" gap="lg">
        <Flex align="center" gap="md" justify="between">
          <Box>{note.title || "Untitled note"}</Box>
          <Button size="icon-sm" variant="destructive" onClick={() => onDelete(note.id)}>
            X
          </Button>
        </Flex>
        <Input
          value={note.title}
          onValueChange={({ value }) => onUpdate(note.id, { title: value })}
        />
        <TextArea
          size="lg"
          value={note.body}
          onValueChange={({ value }) => onUpdate(note.id, { body: value })}
        />
      </Flex>

      <Flex gap="md">
        <Button variant="secondary" onClick={onBack}>
          Cancel
        </Button>
        <Button variant="default" onClick={onBack}>
          Save
        </Button>
      </Flex>
    </Flex>
  );
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default view;
