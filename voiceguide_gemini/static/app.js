const chat = document.getElementById("chat");
const form = document.getElementById("chatForm");
const input = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const micBtn = document.getElementById("micBtn");
const ttsBtn = document.getElementById("ttsBtn");
const statusPill = document.getElementById("statusPill");
const statusText = document.getElementById("statusText");
const welcomeCard = document.getElementById("welcomeCard");
const voicePreview = document.getElementById("voicePreview");
const voicePreviewText = document.getElementById("voicePreviewText");
const supportNote = document.getElementById("supportNote");

let messages = [];
let isBusy = false;
let ttsEnabled = true;
let recognition = null;
let isListening = false;
let listeningRestartTimer = null;

function setStatus(label, mode = "ready") {
    statusText.textContent = label;
    statusPill.className = "status-pill";
    if (mode !== "ready") statusPill.classList.add(`status-${mode}`);
}

function escapeText(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function addMessage(role, content) {
    welcomeCard?.remove();

    const row = document.createElement("div");
    row.className = `message-row ${role}`;

    const bubble = document.createElement("div");
    bubble.className = `message ${role}`;
    bubble.innerHTML = `<div class="message-label">${role === "user" ? "You" : "Gemini"}</div>${escapeText(content)}`;

    row.appendChild(bubble);
    chat.appendChild(row);
    chat.scrollTop = chat.scrollHeight;
}

function addTyping() {
    const row = document.createElement("div");
    row.className = "message-row model";
    row.id = "typingRow";
    row.innerHTML = '<div class="typing" aria-label="Gemini is thinking"><i></i><i></i><i></i></div>';
    chat.appendChild(row);
    chat.scrollTop = chat.scrollHeight;
}

function removeTyping() {
    document.getElementById("typingRow")?.remove();
}

function speak(text) {
    if (!ttsEnabled || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    utterance.pitch = 1;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
}

function resizeInput() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 150) + "px";
}

async function sendMessage(text) {
    const message = text.trim();
    if (!message || isBusy) return;

    isBusy = true;
    input.value = "";
    resizeInput();
    addMessage("user", message);
    messages.push({ role: "user", content: message });
    addTyping();
    sendBtn.disabled = true;
    micBtn.disabled = true;
    setStatus("Thinking…", "thinking");

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, history: messages.slice(-30) })
        });

        const data = await response.json();
        removeTyping();

        if (!response.ok || !data.ok) {
            throw new Error(data.error || "Request failed");
        }

        addMessage("model", data.reply);
        messages.push({ role: "model", content: data.reply });
        setStatus("Ready", "ready");
        speak(data.reply);
    } catch (error) {
        removeTyping();
        const cleanError = error?.message || "Something went wrong.";
        addMessage("model", `Sorry — ${cleanError}`);
        setStatus("Error", "error");
    } finally {
        isBusy = false;
        sendBtn.disabled = false;
        micBtn.disabled = false;
        input.focus();
    }
}

function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        micBtn.disabled = true;
        supportNote.textContent = "Voice input is not supported in this browser. Try Chrome or Edge.";
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        isListening = true;
        micBtn.classList.add("recording");
        micBtn.setAttribute("aria-label", "Stop voice input");
        setStatus("Listening…", "listening");
        voicePreview.hidden = false;
        voicePreviewText.textContent = "Listening… start speaking";
    };

    recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) finalText += transcript;
            else interimText += transcript;
        }

        const display = (finalText || interimText).trim();
        if (display) voicePreviewText.textContent = display;

        if (finalText.trim()) {
            // Keep the transcript visible long enough to make the hand-off obvious.
            setStatus("Got it — sending…", "thinking");
            setTimeout(() => sendMessage(finalText), 300);
        }
    };

    recognition.onerror = (event) => {
        if (event.error === "aborted") return;
        isListening = false;
        micBtn.classList.remove("recording");
        voicePreview.hidden = true;
        setStatus(event.error === "not-allowed" ? "Mic permission needed" : "Voice error", "error");
    };

    recognition.onend = () => {
        isListening = false;
        micBtn.classList.remove("recording");
        micBtn.setAttribute("aria-label", "Start voice input");
        voicePreview.hidden = true;
        if (!isBusy) setStatus("Ready", "ready");
    };
}

micBtn.addEventListener("click", () => {
    if (!recognition || isBusy) return;

    if (isListening) {
        recognition.stop();
        return;
    }

    try {
        window.speechSynthesis?.cancel();
        voicePreviewText.textContent = "Warming up microphone…";
        voicePreview.hidden = false;
        setStatus("Preparing mic…", "listening");
        // Small lead-in gives the UI time to visibly enter listening mode before the browser starts capture.
        clearTimeout(listeningRestartTimer);
        listeningRestartTimer = setTimeout(() => recognition.start(), 550);
    } catch (error) {
        setStatus("Could not start mic", "error");
        voicePreview.hidden = true;
    }
});

ttsBtn.addEventListener("click", () => {
    ttsEnabled = !ttsEnabled;
    ttsBtn.classList.toggle("active", ttsEnabled);
    ttsBtn.setAttribute("aria-label", ttsEnabled ? "Disable spoken replies" : "Enable spoken replies");
    if (!ttsEnabled) window.speechSynthesis?.cancel();
});

form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(input.value);
});

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
    }
});

setupSpeechRecognition();
resizeInput();
input.focus();
