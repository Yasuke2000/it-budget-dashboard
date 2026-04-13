"use client";

import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, RotateCcw, Sparkles, Bot, User } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "Where can we cut costs?",
  "Which licenses are wasted?",
  "Is our vendor concentration risky?",
  "What contracts expire soon?",
  "Summarize our IT financial health",
];

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: "user", content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });
      const data = await res.json();
      setMessages([
        ...newMessages,
        { role: "assistant", content: data.content },
      ]);
    } catch {
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function clearChat() {
    setMessages([]);
    setInput("");
  }

  return (
    <div className="flex flex-col h-full bg-slate-950">
      {/* Header actions */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
        <span className="text-xs text-slate-500 font-medium uppercase tracking-wider">
          Chat
        </span>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-slate-400 hover:text-white hover:bg-slate-800"
            onClick={clearChat}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            New chat
          </Button>
        )}
      </div>

      {/* Messages area */}
      <ScrollArea className="flex-1 min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Empty state with suggestions */}
            {messages.length === 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-teal-400">
                  <Sparkles className="h-5 w-5" />
                  <span className="text-sm font-medium">
                    Ask about your IT finances
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  I can analyze your spending, licenses, vendors, contracts, and
                  budget. Try one of these:
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => sendMessage(suggestion)}
                      className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-teal-400 hover:border-teal-400/50 transition-colors cursor-pointer"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message bubbles */}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 h-7 w-7 rounded-full bg-teal-600/20 flex items-center justify-center mt-0.5">
                    <Bot className="h-4 w-4 text-teal-400" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-teal-600/20 text-slate-200"
                      : "bg-slate-800 text-slate-300"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
                        ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
                        li: ({ children }) => <li>{children}</li>,
                        code: ({ children }) => <code className="bg-slate-700 px-1 py-0.5 rounded text-xs font-mono text-teal-300">{children}</code>,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex-shrink-0 h-7 w-7 rounded-full bg-slate-700 flex items-center justify-center mt-0.5">
                    <User className="h-4 w-4 text-slate-300" />
                  </div>
                )}
              </div>
            ))}

            {/* Loading indicator */}
            {loading && (
              <div className="flex gap-3 justify-start">
                <div className="flex-shrink-0 h-7 w-7 rounded-full bg-teal-600/20 flex items-center justify-center mt-0.5">
                  <Bot className="h-4 w-4 text-teal-400" />
                </div>
                <div className="bg-slate-800 rounded-lg px-3 py-2">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 rounded-full bg-teal-400 animate-bounce [animation-delay:0ms]" />
                    <span className="h-2 w-2 rounded-full bg-teal-400 animate-bounce [animation-delay:150ms]" />
                    <span className="h-2 w-2 rounded-full bg-teal-400 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Input bar */}
      <div className="border-t border-slate-800 p-3">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your IT finances..."
            disabled={loading}
            className="flex-1 bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-500 focus-visible:border-teal-500 focus-visible:ring-teal-500/20"
          />
          <Button
            size="icon"
            className="h-8 w-8 bg-teal-600 hover:bg-teal-500 text-white shrink-0"
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
