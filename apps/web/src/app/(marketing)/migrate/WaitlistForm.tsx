"use client";

import { useState } from "react";
import Button from "@/components/Button";
import Input from "@/components/Input";
import styles from "./migrate.module.css";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (submitted) {
    return (
      <p className={styles.success} role="status">
        You’re on the list. We’ll email you the moment AI migration launches.
      </p>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (!isValid) return;
        // TODO: POST to a real waitlist endpoint once the backend exists. For
        // now this only acknowledges client-side — no email is persisted yet.
        setSubmitted(true);
      }}
    >
      <div className={styles.field}>
        <Input
          id="waitlist-email"
          label="Email address"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
        />
      </div>
      <Button type="submit" isDisabled={!isValid}>
        Join the waitlist
      </Button>
    </form>
  );
}
