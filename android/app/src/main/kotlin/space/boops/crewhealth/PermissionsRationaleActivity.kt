package space.boops.crewhealth

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Displays BOOPS's offline-only, crew-first privacy explanation when opened from
 * Health Connect permission settings (`ACTION_SHOW_PERMISSIONS_RATIONALE` or
 * Android 14+ `VIEW_PERMISSION_USAGE`).
 */
class PermissionsRationaleActivity : ComponentActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    val bgColor = Color.parseColor("#F4F5F7")
    val inkPrimary = Color.parseColor("#111827")
    val inkSecondary = Color.parseColor("#374151")
    val cardBg = Color.WHITE
    val borderColor = Color.parseColor("#E5E7EB")

    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.light(bgColor, bgColor),
      navigationBarStyle = SystemBarStyle.light(bgColor, bgColor),
    )

    val density = resources.displayMetrics.density
    fun dp(value: Int): Int = (value * density).toInt()

    val root = ScrollView(this).apply {
      setBackgroundColor(bgColor)
      isFillViewport = true
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      )
    }

    val container = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(20), dp(24), dp(20), dp(24))
      layoutParams = ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      )
    }

    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(20), dp(20), dp(20), dp(20))
      background = GradientDrawable().apply {
        setColor(cardBg)
        cornerRadius = dp(16).toFloat()
        setStroke(dp(1), borderColor)
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
    }

    val badge = TextView(this).apply {
      text = "OFFLINE · CREW-FIRST PRIVACY"
      setTextColor(Color.parseColor("#1F2937"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
      typeface = Typeface.DEFAULT_BOLD
      setPadding(dp(10), dp(4), dp(10), dp(4))
      background = GradientDrawable().apply {
        setColor(Color.parseColor("#E5E7EB"))
        cornerRadius = dp(999).toFloat()
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
    }

    val heading = TextView(this).apply {
      text = getString(R.string.health_connect_rationale_heading)
      setTextColor(inkPrimary)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
      typeface = Typeface.DEFAULT_BOLD
      setPadding(0, dp(14), 0, dp(10))
    }

    val body = TextView(this).apply {
      text = getString(R.string.health_connect_rationale_body)
      setTextColor(inkSecondary)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      setLineSpacing(dp(4).toFloat(), 1.0f)
      setPadding(0, 0, 0, dp(20))
    }

    val closeButton = Button(this).apply {
      text = getString(R.string.health_connect_rationale_close)
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
      typeface = Typeface.DEFAULT_BOLD
      isAllCaps = false
      gravity = Gravity.CENTER
      setPadding(dp(24), dp(12), dp(24), dp(12))
      background = GradientDrawable().apply {
        setColor(inkPrimary)
        cornerRadius = dp(999).toFloat()
      }
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      )
      setOnClickListener { finish() }
    }

    card.addView(badge)
    card.addView(heading)
    card.addView(body)
    card.addView(closeButton)
    container.addView(card)
    root.addView(container)
    setContentView(root)

    ViewCompat.setOnApplyWindowInsetsListener(root) { view, windowInsets ->
      val insets = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
      )
      view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
