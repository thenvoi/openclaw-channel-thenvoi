/**
 * Unit tests for prompts module.
 */

import { describe, it, expect } from "vitest";
import { BASE_INSTRUCTIONS, buildSystemPrompt } from "../../src/prompts.js";

describe("Prompts", () => {
  describe("BASE_INSTRUCTIONS", () => {
    it("should contain channel instructions section", () => {
      expect(BASE_INSTRUCTIONS).toContain("## Thenvoi Channel Instructions");
    });

    it("should explain two operating contexts", () => {
      expect(BASE_INSTRUCTIONS).toContain("Webchat/CLI context");
      expect(BASE_INSTRUCTIONS).toContain("Thenvoi room context");
    });

    it("should mention plain text auto-routing", () => {
      expect(BASE_INSTRUCTIONS).toContain("automatically routed");
      expect(BASE_INSTRUCTIONS).toContain("plain text");
    });

    it("should list tools that work without room_id", () => {
      expect(BASE_INSTRUCTIONS).toContain("thenvoi_lookup_peers");
      expect(BASE_INSTRUCTIONS).toContain("thenvoi_add_contact");
      expect(BASE_INSTRUCTIONS).toContain("thenvoi_create_chatroom");
    });

    it("should list tools that require room_id", () => {
      expect(BASE_INSTRUCTIONS).toContain("thenvoi_send_message");
      expect(BASE_INSTRUCTIONS).toContain("thenvoi_send_event");
      expect(BASE_INSTRUCTIONS).toContain("thenvoi_add_participant");
    });

    it("should contain delegation instructions", () => {
      expect(BASE_INSTRUCTIONS).toContain("Delegating to Other Agents");
      expect(BASE_INSTRUCTIONS).toContain("lookup_peers");
      expect(BASE_INSTRUCTIONS).toContain("add_participant");
    });

    it("should contain examples", () => {
      expect(BASE_INSTRUCTIONS).toContain("Example:");
      expect(BASE_INSTRUCTIONS).toContain("Webchat");
    });
  });

  describe("buildSystemPrompt", () => {
    it("should include agent identity", () => {
      const prompt = buildSystemPrompt(
        "Weather Agent",
        "a helpful weather assistant",
      );

      expect(prompt).toContain("You are Weather Agent");
      expect(prompt).toContain("a helpful weather assistant");
    });

    it("should include base instructions", () => {
      const prompt = buildSystemPrompt("Test Agent", "a test agent");

      expect(prompt).toContain("## Thenvoi Channel Instructions");
      expect(prompt).toContain("lookup_peers");
    });

    it("should include custom instructions when provided", () => {
      const customInstructions = "Always be polite and helpful.";
      const prompt = buildSystemPrompt(
        "Test Agent",
        "a test agent",
        customInstructions,
      );

      expect(prompt).toContain(customInstructions);
    });

    it("should order sections correctly", () => {
      const customInstructions = "CUSTOM_MARKER";
      const prompt = buildSystemPrompt(
        "Test Agent",
        "a test agent",
        customInstructions,
      );

      const identityIndex = prompt.indexOf("You are Test Agent");
      const customIndex = prompt.indexOf("CUSTOM_MARKER");
      const baseIndex = prompt.indexOf("## Thenvoi Channel Instructions");

      expect(identityIndex).toBeLessThan(customIndex);
      expect(customIndex).toBeLessThan(baseIndex);
    });

    it("should work without custom instructions", () => {
      const prompt = buildSystemPrompt("Test Agent", "a test agent");

      expect(prompt).toContain("You are Test Agent");
      expect(prompt).toContain("## Thenvoi Channel Instructions");
      expect(prompt).not.toContain("undefined");
    });

    it("should separate sections with blank lines", () => {
      const prompt = buildSystemPrompt(
        "Test Agent",
        "a test agent",
        "Custom section",
      );

      // Check for double newlines (blank line separation)
      expect(prompt).toContain("\n\n");
    });
  });
});
