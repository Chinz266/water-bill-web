import { Component } from '@angular/core';
import { RouterModule, RouterOutlet } from '@angular/router';
import { NavbarComponent } from './layout/navbar/navbar'; // 🌟 ดึง Navbar มาใช้

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterModule, NavbarComponent], // 🌟 เอามาใส่ใน imports
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class AppComponent {
  title = 'water-bill-web';
}