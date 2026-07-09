import React, { useEffect, useMemo, useState, useRef } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { FaBars } from "@react-icons/all-files/fa/FaBars";
import { FaUser } from "@react-icons/all-files/fa/FaUser";
import { FaUserShield } from "@react-icons/all-files/fa/FaUserShield";
import { FaChalkboardTeacher } from "@react-icons/all-files/fa/FaChalkboardTeacher";
import { FaLaptopCode } from "@react-icons/all-files/fa/FaLaptopCode";
import { FaBook } from "@react-icons/all-files/fa/FaBook";
import { FaChartLine } from "@react-icons/all-files/fa/FaChartLine";
import { FaProjectDiagram } from "@react-icons/all-files/fa/FaProjectDiagram";
import { FaCalendarAlt } from "@react-icons/all-files/fa/FaCalendarAlt";
import { FaClipboardList } from "@react-icons/all-files/fa/FaClipboardList";
import { FaThLarge } from "@react-icons/all-files/fa/FaThLarge";
import { FaChevronDown } from "@react-icons/all-files/fa/FaChevronDown";
import "../index.css";
import "./NavBar.css";

import { getApiBase } from "../lib/apiBase";
const API_BASE = getApiBase();
// A "Forms" nav dropdown styled to match the pill buttons. Holds secondary nav
// items so the header doesn't grow a button per feature.
function NavDropdown({ label, Icon, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();

  // Close on outside click or route change.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const groupActive = items.some((it) => location.pathname.startsWith(it.to));

  return (
    <div className="nav-dropdown" ref={ref}>
      <button
        type="button"
        className={"nav-pill nav-dropdown-trigger" + (groupActive ? " active" : "")}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        title={label}
      >
        <Icon size={15} />
        <span>{label}</span>
        <FaChevronDown size={11} className={"nav-dropdown-caret" + (open ? " open" : "")} />
      </button>
      {open && (
        <div className="nav-dropdown-menu" role="menu">
          {items.map(({ to, label: itemLabel, Icon: ItemIcon }) => (
            <NavLink
              key={to}
              to={to}
              role="menuitem"
              className={({ isActive }) => "nav-dropdown-item" + (isActive ? " active" : "")}
            >
              <ItemIcon size={14} />
              <span>{itemLabel}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NavBar({ role, authenticated, onToggleSidebar, onBrandClick }) {
  const [scrolled, setScrolled] = useState(false);
  const [profilePicture, setProfilePicture] = useState("/user_icon.webp");
  const navigate = useNavigate();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Fetch user profile picture - PRESERVED
  useEffect(() => {
    if (role) {
      fetchProfilePicture();
    }
  }, [role]);

  const fetchProfilePicture = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE}/api/profile`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();

        // 🔥 FIXED: Handle base64 data URLs, full URLs, and relative paths
        let pictureUrl = data.profilePicture || "/user_icon.webp";
        if (pictureUrl) {
          if (pictureUrl.startsWith('data:')) {
            // Base64 data URL - use directly
          } else if (pictureUrl.startsWith('http')) {
            // Full URL - use directly
          } else if (pictureUrl.startsWith('/user_icon.webp')) {
            // Default icon - use directly
          } else {
            // Relative path - prepend API base
            pictureUrl = `${API_BASE}${pictureUrl}`;
          }
        }

        console.log("✅ Navbar profile picture loaded");
        setProfilePicture(pictureUrl);
      }
    } catch (error) {
      console.error("❌ Error fetching profile picture:", error);
    }
  };

  const linkClass = ({ isActive }) => "nav-link" + (isActive ? " active" : "");
  const pillClass = ({ isActive }) => "nav-pill" + (isActive ? " active" : "");
  const isAuthed = useMemo(() => Boolean(authenticated), [authenticated]);

  // Primary feature nav — moved out of the sidebar into the top bar (ORA style).
  // The most-used items stay as flat pills; secondary tools/features (Planner,
  // Ripple Effect, and the new Advising form) live in a single "Tools" dropdown
  // so the header stays tidy.
  const primaryNav = [
    { to: "/my-classes", label: "My Classes", Icon: FaChalkboardTeacher },
    { to: "/coding", label: "Coding Tutor", Icon: FaLaptopCode },
    { to: "/grade-analysis", label: "Grade Surgeon", Icon: FaChartLine },
  ];
  const toolsNav = [
    { to: "/advising", label: "Advising Form", Icon: FaClipboardList },
    { to: "/curriculum", label: "Curriculum", Icon: FaBook },
    { to: "/planner", label: "Planner", Icon: FaCalendarAlt },
    { to: "/ripple-effect", label: "Ripple Effect", Icon: FaProjectDiagram },
  ];

  return (
    <nav className={`navbar ${scrolled ? "scrolled" : ""}`}>
      <div className="nav-container">
        {/* Always-visible sidebar toggle so users can find it without hovering. */}
        {isAuthed && (
          <button
            type="button"
            className="sidebar-menu-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSidebar();
            }}
            title="Toggle sidebar"
            aria-label="Toggle sidebar"
          >
            <FaBars size={20} />
          </button>
        )}

        {/* Left side - logo and title - CLICKABLE */}
        <div
          className="navbar-left"
          onClick={() => {
            if (isAuthed && onBrandClick) onBrandClick();
            else navigate(isAuthed ? "/chat" : "/");
          }}
          style={{ cursor: 'pointer' }}
          title={isAuthed ? "Go to your most recent chat" : "Return to Home"}
        >
          <img
            src="/msu_logo.webp"
            alt="Morgan State University"
            className="nav-logo"
          />

          <div className="nav-title">
            <span className="brand-main">CS NAVIGATOR</span>
            <span className="brand-sub">Morgan State University</span>
          </div>
        </div>

        {/* Primary feature nav as pills (top bar, ORA style) */}
        {isAuthed && (
          <nav className="nav-primary-links" aria-label="Primary navigation">
            {/* eslint-disable-next-line no-unused-vars -- Icon is used as a JSX
               component below; this config lacks react/jsx-uses-vars to see that. */}
            {primaryNav.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} className={pillClass} title={label}>
                <Icon size={15} />
                <span>{label}</span>
              </NavLink>
            ))}
            <NavDropdown label="Tools" Icon={FaThLarge} items={toolsNav} />
          </nav>
        )}

        {/* Right side - Profile icon when authenticated */}
        {isAuthed && (
          <div className="navbar-right">
            {role === "admin" && (
              <button
                type="button"
                className="admin-nav-btn"
                onClick={() => navigate("/admin")}
                title="Open admin dashboard"
                aria-label="Open admin dashboard"
              >
                <FaUserShield size={16} />
                <span>Admin</span>
              </button>
            )}
            <button
              className="profile-icon-btn"
              onClick={() => navigate("/profile")}
              title="Manage User Profile"
              aria-label="Open profile settings"
            >
              <img
                src={profilePicture}
                alt="Profile"
                className="profile-avatar"
                onError={(e) => {
                  console.log("❌ Image failed to load, showing fallback");
                  e.target.style.display = 'none';
                  const fallback = e.target.nextElementSibling;
                  if (fallback) fallback.style.display = 'flex';
                }}
              />
              <div className="profile-icon-fallback">
                <FaUser size={18} />
              </div>
            </button>
          </div>
        )}

        {/* Show links only when NOT authenticated */}
        {!isAuthed && (
          <div className="nav-links" aria-label="Primary navigation">
            <NavLink to="/trychat" className="nav-link try-free-link">
              Try Free
            </NavLink>

            <NavLink to="/login" className={linkClass}>
              Login
            </NavLink>

            <NavLink to="/signup" className="btn-primary nav-cta">
              Sign Up
            </NavLink>
          </div>
        )}
      </div>
    </nav>
  );
}
