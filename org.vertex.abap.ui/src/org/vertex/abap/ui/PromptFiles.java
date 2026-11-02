package org.vertex.abap.ui;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** User prompt files shared with the VS Code extension. */
final class PromptFiles {
    private PromptFiles() {}

    static String run(String kind, String operation, String content, int id) {
        String name = switch (kind) {
            case "review" -> "code-review.txt";
            case "technical" -> "technical-documentation.txt";
            default -> null;
        };
        if (name == null || !(operation.equals("read") || operation.equals("save") || operation.equals("reset")))
            return error(id, "Unsupported prompt request.");
        Path file = Path.of(System.getProperty("user.home"), ".vertex", "prompts", name);
        try {
            if (operation.equals("save")) {
                if (content == null || content.isBlank() || content.length() > 65536)
                    return error(id, "Prompt must contain 1 to 65536 characters.");
                Files.createDirectories(file.getParent());
                Files.writeString(file, content, StandardCharsets.UTF_8);
            } else if (operation.equals("reset")) {
                Files.deleteIfExists(file);
            }
            boolean exists = Files.isRegularFile(file);
            String text = exists ? Files.readString(file, StandardCharsets.UTF_8) : "";
            return "{\"id\":" + id + ",\"kind\":" + AssistantBridge.quote(kind)
                + ",\"path\":" + AssistantBridge.quote(file.toString())
                + ",\"exists\":" + exists + ",\"text\":" + AssistantBridge.quote(text) + "}";
        } catch (IOException | SecurityException e) {
            return error(id, String.valueOf(e.getMessage()));
        }
    }

    private static String error(int id, String message) {
        return "{\"id\":" + id + ",\"error\":" + AssistantBridge.quote(message) + "}";
    }
}
